/**
 * @file vitest/temperatures.test.ts
 * @description Tests for host temperature discovery.
 * @author Luca Liguori
 */

import { mkdtemp, mkdir, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { readLinuxTemperatures, sampleCpuTemperatures, sensorSerial } from '../src/temperatures.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: vi.fn(actual.realpath), readdir: vi.fn(actual.readdir) };
});

let root: string;

async function file(name: string, text: string): Promise<void> {
  const destination = path.join(root, name);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, text);
}

beforeEach(async () => {
  vi.mocked(realpath).mockReset();
  root = await mkdtemp(path.join(os.tmpdir(), 'host-health-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('Linux CPU discovery', () => {
  it('should expose all CPU channels and exclude unrelated hardware', async () => {
    await file('class/hwmon/hwmon0/name', 'coretemp\n');
    await file('class/hwmon/hwmon0/temp1_label', 'Package id 0');
    await file('class/hwmon/hwmon0/temp1_input', '42000\n');
    await file('class/hwmon/hwmon0/temp2_label', 'Core 0');
    await file('class/hwmon/hwmon0/temp2_input', '41500');
    await file('class/hwmon/hwmon1/name', 'nvme');
    await file('class/hwmon/hwmon1/temp1_input', '30000');
    await file('class/hwmon/hwmon2/name', 'k10temp');
    await file('class/hwmon/hwmon2/temp1_input', '55000');
    expect((await readLinuxTemperatures(root)).map(({ celsius }) => celsius)).toEqual([42, 41.5, 55]);
  });

  it('should identify CPU labels in motherboard drivers', async () => {
    await file('class/hwmon/hwmon0/name', 'nct6798');
    await file('class/hwmon/hwmon0/temp1_label', 'CPU');
    await file('class/hwmon/hwmon0/temp1_input', '42500');
    await file('class/hwmon/hwmon0/temp2_label', 'System');
    await file('class/hwmon/hwmon0/temp2_input', '30000');
    expect(await readLinuxTemperatures(root)).toHaveLength(1);
  });

  it('should fall back to CPU thermal zones and ignore GPU zones', async () => {
    await file('class/thermal/thermal_zone0/type', 'cpu-thermal');
    await file('class/thermal/thermal_zone0/temp', '51250');
    await file('class/thermal/thermal_zone1/type', 'gpu');
    await file('class/thermal/thermal_zone1/temp', '60000');
    expect(await readLinuxTemperatures(root)).toEqual([
      { id: 'thermal/cpu-thermal/thermal_zone0', name: 'cpu-thermal thermal_zone0', celsius: 51.25, source: path.join(root, 'class/thermal/thermal_zone0/temp') },
    ]);
  });

  it('should avoid duplicate hwmon aliases and keep identities stable when indices change', async () => {
    await file('devices/platform/coretemp.0/hwmon/hwmon0/name', 'coretemp');
    await file('devices/platform/coretemp.0/hwmon/hwmon0/temp1_input', '40000');
    await mkdir(path.join(root, 'class/hwmon'), { recursive: true });
    await symlink(path.join(root, 'devices/platform/coretemp.0/hwmon/hwmon0'), path.join(root, 'class/hwmon/hwmon8'), 'junction');
    await symlink(path.join(root, 'devices/platform/coretemp.0/hwmon/hwmon0'), path.join(root, 'class/hwmon/hwmon9'), 'junction');
    const readings = await readLinuxTemperatures(root);
    expect(readings).toHaveLength(1);
    expect(readings[0].id).toBe(path.join(await realpath(root), 'devices/platform/coretemp.0/temp1_input'));
  });

  it.each(['', 'NaN', 'Infinity', 'not a number', '400000', '-300000'])('should report unavailable for invalid input %j', async (text) => {
    await file('class/hwmon/hwmon0/name', 'coretemp');
    await file('class/hwmon/hwmon0/temp1_input', text);
    expect((await readLinuxTemperatures(root))[0].celsius).toBeNull();
  });

  it('should tolerate missing files and empty sysfs mounts', async () => {
    expect(await readLinuxTemperatures(root)).toEqual([]);
    await file('class/hwmon/hwmon0/name', 'unknown');
    await file('class/hwmon/hwmon0/temp1_input', '42000');
    expect(await readLinuxTemperatures(root)).toEqual([]);
  });
});

describe('sensor identities', () => {
  it('should produce stable bounded serials and distinguish sensors', () => {
    expect(sensorSerial('host/cpu0')).toBe(sensorSerial('host/cpu0'));
    expect(sensorSerial('host/cpu0')).not.toBe(sensorSerial('host/cpu1'));
    expect(sensorSerial('host/cpu0').length).toBeLessThanOrEqual(32);
  });
});

describe('sensor access edge cases', () => {
  it('should tolerate realpath failures and use CPU labels without a driver name', async () => {
    await file('class/hwmon/hwmon0/temp1_label', 'CPU');
    await file('class/hwmon/hwmon0/temp1_input', '44000');
    vi.mocked(realpath).mockRejectedValueOnce(new Error('directory unavailable')).mockRejectedValueOnce(new Error('link unavailable'));
    expect(await readLinuxTemperatures(root)).toEqual([
      { id: path.join(root, 'class/temp1_input'), name: 'CPU CPU', celsius: 44, source: path.join(root, 'class/hwmon/hwmon0/temp1_input') },
    ]);
  });
});

describe('updates from startup sources', () => {
  it('should read only saved Linux files without enumerating directories', async () => {
    await file('class/hwmon/hwmon0/name', 'coretemp');
    await file('class/hwmon/hwmon0/temp1_input', '40000');
    const sources = await readLinuxTemperatures(root);
    vi.mocked(readdir).mockClear();
    await file('class/hwmon/hwmon0/temp1_input', '45000');
    await file('class/hwmon/hwmon0/temp2_input', '60000');
    expect((await sampleCpuTemperatures(sources)).map(({ celsius }) => celsius)).toEqual([45]);
    await rm(path.join(root, 'class/hwmon/hwmon0/temp1_input'));
    expect((await sampleCpuTemperatures(sources))[0].celsius).toBeNull();
    expect(vi.mocked(readdir)).not.toHaveBeenCalled();
    expect(await sampleCpuTemperatures([{ id: 'missing', name: 'CPU', celsius: 10 }])).toEqual([{ id: 'missing', name: 'CPU', celsius: null }]);
  });
});
