/**
 * @file vitest/module.test.ts
 * @description Host health platform lifecycle tests with the shared Matterbridge harness.
 * @author Luca Liguori
 */

import type { PlatformMatterbridge } from 'matterbridge';
import { BridgedDeviceBasicInformation, TemperatureMeasurement } from 'matterbridge/matter/clusters';
import {
  addMatterbridge,
  createServerNode,
  createTestEnvironment,
  destroyTestEnvironment,
  flushServerNode,
  getMatterbridge,
  log,
  loggerErrorSpy,
  loggerFatalSpy,
  loggerInfoSpy,
  loggerWarnSpy,
  setupTest,
} from 'matterbridge/test-utils/vitest';
import { bgBlue, info } from 'node-ansi-logger';

import initializePlugin, { HostHealthPlatform, type HostHealthPlatformConfig } from '../src/module.js';

const state = vi.hoisted(() => ({ platform: 'linux', hostname: 'host', read: vi.fn(), sample: vi.fn() }));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  platform: (): string => state.platform,
  hostname: (): string => state.hostname,
}));
vi.mock('../src/temperatures.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/temperatures.js')>()),
  readLinuxTemperatures: state.read,
  sampleCpuTemperatures: state.sample,
}));

await setupTest('HostHealthPlatform', false);

const config: HostHealthPlatformConfig = {
  name: 'matterbridge-host-health',
  type: 'DynamicPlatform',
  version: '1.0.0',
  whiteList: [],
  blackList: [],
  nodeLabels: {},
  pollInterval: 5,
  sysfsPath: '/sys',
  debug: false,
  unregisterOnShutdown: true,
};

let matterbridge: PlatformMatterbridge;
let instance: HostHealthPlatform;
let expectedWarnings: string[];
let testIndex = 0;

beforeAll(async () => {
  await createTestEnvironment();
  await createServerNode(6000);
  matterbridge = getMatterbridge();
});

beforeEach(() => {
  vi.clearAllMocks();
  expectedWarnings = [];
  state.platform = 'linux';
  state.hostname = `host-${testIndex++}`;
  state.sample.mockReset();
  state.sample.mockImplementation(async (sources: unknown[]) => sources);
  state.read.mockResolvedValue([
    { id: 'cpu0', name: 'Core 0', celsius: 42.25 },
    { id: 'cpu1', name: 'Core 1', celsius: 45 },
  ]);
  instance = initializePlugin(matterbridge, log, { ...config, whiteList: [], blackList: [] });
  addMatterbridge(instance);
});

afterEach(async () => {
  vi.useRealTimers();
  const devices = instance.getDevices();
  await instance.onShutdown();
  for (const device of devices) {
    if (device.owner) await device.delete();
  }
  expect(loggerWarnSpy.mock.calls).toEqual(expectedWarnings.map((message) => [message]));
  expect(loggerErrorSpy).not.toHaveBeenCalled();
  expect(loggerFatalSpy).not.toHaveBeenCalled();
});

afterAll(async () => {
  await flushServerNode();
  await destroyTestEnvironment();
  vi.restoreAllMocks();
});

describe('host health lifecycle', () => {
  it('should apply updated node labels when configuration changes', async () => {
    await instance.onStart();
    const [device] = instance.getDevices();
    const updatedConfig = { ...instance.config, nodeLabels: { [`${state.hostname} Core 0`]: { name: 'Updated CPU' } } };
    instance.config = updatedConfig;
    await instance.onConfigChanged(updatedConfig);
    expect(instance.config).toBe(updatedConfig);
    expect(device.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Updated CPU');
    expect(loggerInfoSpy).toHaveBeenCalledWith(`Set node label for "${state.hostname} Core 0" to "Updated CPU"`);
    const withoutLabels = { ...updatedConfig };
    Reflect.deleteProperty(withoutLabels, 'nodeLabels');
    instance.config = withoutLabels;
    await instance.onConfigChanged(withoutLabels);
    expect(instance.config.nodeLabels).toEqual({});
    expect(device.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Updated CPU');
  });

  it('should apply configured node labels to matching devices and log the changes', async () => {
    await instance.onStart();
    const [first, second] = instance.getDevices();
    const key = `${state.hostname} Core 0`;
    instance.config.nodeLabels = {
      [key]: { name: 'Living room CPU' },
      'Missing device': { name: 'Missing CPU' },
      [`${state.hostname} Core 1`]: { name: 'Second CPU' },
    };
    expectedWarnings = ['Device "Missing device" not found while configuring node label'];
    await instance.onConfigure();
    expect(first.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Living room CPU');
    expect(second.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Second CPU');
    expect(loggerInfoSpy).toHaveBeenCalledWith(`Set node label for "${key}" to "Living room CPU"`);
    expect(loggerInfoSpy).not.toHaveBeenCalledWith('Set node label for "Missing device" to "Missing CPU"');
    expect(loggerWarnSpy).toHaveBeenCalledWith(expectedWarnings[0]);
    expect(loggerInfoSpy).toHaveBeenCalledWith(info`Platform ${bgBlue.white`${config.name}`} configured successfully`);
  });

  it.each([undefined, null, 42, '', 'a'.repeat(33)])('should warn and continue applying later labels when the name is invalid: %s', async (name) => {
    await instance.onStart();
    const devices = instance.getDevices();
    const labels = devices.map((device) => device.getAttribute(BridgedDeviceBasicInformation, 'nodeLabel'));
    const key = `${state.hostname} Core 0`;
    const entry = {};
    if (name !== undefined) Reflect.set(entry, 'name', name);
    instance.config.nodeLabels = { [key]: entry, [`${state.hostname} Core 1`]: { name: 'Valid label' } };
    expectedWarnings = [`Invalid node label for "${key}": name must be a string between 1 and 32 characters`];
    await instance.onConfigure();
    expect(devices[0].getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe(labels[0]);
    expect(devices[1].getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Valid label');
    expect(loggerWarnSpy).toHaveBeenCalledWith(expectedWarnings[0]);
    expect(loggerInfoSpy).toHaveBeenCalledWith(info`Platform ${bgBlue.white`${config.name}`} configured successfully`);
  });

  it.each(['a', 'a'.repeat(32)])('should accept a node label at the length boundary: %s', async (name) => {
    await instance.onStart();
    instance.config.nodeLabels = { [`${state.hostname} Core 0`]: { name } };
    await instance.onConfigure();
    expect(instance.getDevices()[0].getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe(name);
  });

  it('should apply configured node labels immediately after device registration', async () => {
    const key = `${state.hostname} Core 0`;
    const secondKey = `${state.hostname} Core 1`;
    instance.config.nodeLabels = {
      [key]: { name: 'Startup CPU' },
      [secondKey]: { name: 'Second CPU' },
      'Missing device': {},
    };
    await instance.onStart();
    expect(instance.getDevices()[0].getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Startup CPU');
    expect(instance.getDevices()[1].getAttribute(BridgedDeviceBasicInformation, 'nodeLabel')).toBe('Second CPU');
    expect(loggerInfoSpy).toHaveBeenCalledWith(`Set node label for "${key}" to "Startup CPU"`);
    expect(loggerInfoSpy.mock.calls.filter(([message]) => message === `Set node label for "${key}" to "Startup CPU"`)).toHaveLength(1);
    expect(loggerInfoSpy).toHaveBeenCalledWith(`Set node label for "${secondKey}" to "Second CPU"`);
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it('should initialize the platform and reject unsupported Matterbridge versions', () => {
    expect(instance).toBeInstanceOf(HostHealthPlatform);
    expect(() => initializePlugin({ ...matterbridge, matterbridgeVersion: '3.0.0' }, log, { ...config })).toThrow('This plugin requires Matterbridge >= 3.11.0.');
  });

  it('should register real temperature endpoints and update centidegrees on each poll', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await instance.onStart();
    const devices = instance.getDevices();
    expect(devices).toHaveLength(2);
    expect(devices.map((device) => device.getAttribute(TemperatureMeasurement, 'measuredValue'))).toEqual([4225, 4500]);
    for (const device of devices) {
      expect(device.getAllClusterServerNames()).toContain('temperatureMeasurement');
      expect(device.getAllClusterServerNames()).not.toContain('onOff');
      expect(device.getAllClusterServerNames()).not.toContain('thermostat');
    }
    state.sample.mockResolvedValue([{ id: 'cpu0', name: 'Core 0', celsius: 50 }]);
    await instance.onConfigure();
    state.sample.mockResolvedValue([{ id: 'cpu0', name: 'Core 0', celsius: 51 }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(instance.getDevices()).toEqual(devices);
    expect(devices.map((device) => device.getAttribute(TemperatureMeasurement, 'measuredValue'))).toEqual([5100, null]);
    await instance.onConfigure();
    expect(loggerWarnSpy).not.toHaveBeenCalled();
  });

  it.each(['win32', 'darwin'])('should show a snackbar and create no devices on unsupported platform %s', async (hostPlatform) => {
    await instance.onShutdown();
    state.platform = hostPlatform;
    expectedWarnings = [`Host Health supports Linux only. No devices will be created on ${hostPlatform}.`];
    instance = initializePlugin(matterbridge, log, { ...config });
    addMatterbridge(instance);
    const snackbar = vi.spyOn(instance, 'wssSendSnackbarMessage');
    await instance.onStart('test');
    expect(state.read).not.toHaveBeenCalled();
    expect(instance.getDevices()).toHaveLength(0);
    expect(snackbar).toHaveBeenCalledWith(expect.stringContaining('Linux only'), 0, 'warning');
  });

  it('should honor the real device selection lists', async () => {
    instance.config.whiteList = ['No devices'];
    await instance.onStart();
    expect(instance.getDevices()).toHaveLength(0);
  });

  it('should unregister real endpoints and stop polling on shutdown', async () => {
    await instance.onStart();
    expect(instance.getDevices()).toHaveLength(2);
    await instance.onShutdown('test');
    expect(instance.getDevices()).toHaveLength(0);
    state.read.mockClear();
    await instance.onConfigure();
    expect(state.read).not.toHaveBeenCalled();
  });

  it('should require startup to create devices after recovering from Linux read failures', async () => {
    await instance.onShutdown();
    instance = initializePlugin(matterbridge, log, { ...config });
    addMatterbridge(instance);
    state.read.mockRejectedValue(new Error('sysfs requires permissions'));
    expectedWarnings = ['Unable to read CPU temperatures: sysfs requires permissions'];
    await instance.onStart();
    await instance.onConfigure();
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    state.read.mockResolvedValue([{ id: 'cpu0', name: 'Core 0', celsius: 55 }]);
    await instance.onConfigure();
    expect(instance.getDevices()).toHaveLength(0);
    await instance.onStart('retry startup');
    expect(instance.getDevices()).toHaveLength(1);
    expect(instance.getDevices()[0].getAttribute(TemperatureMeasurement, 'measuredValue')).toBe(5500);
  });

  it('should report missing sensors once and use the configured mount root', async () => {
    await instance.onShutdown();
    instance = initializePlugin(matterbridge, log, { ...config, sysfsPath: '/host-sys' });
    addMatterbridge(instance);
    state.read.mockResolvedValue([]);
    expectedWarnings = ['No CPU temperatures found. Check Linux sensor availability and sysfs permissions.'];
    await instance.onStart();
    await instance.onConfigure();
    expect(state.read).toHaveBeenCalledWith('/host-sys');
    expect(loggerWarnSpy).toHaveBeenCalledTimes(1);
    expect(instance.getDevices()).toHaveLength(0);
    state.sample.mockRejectedValue(new Error('Sensor read failed'));
    expectedWarnings.push('Unable to read CPU temperatures: Sensor read failed');
    await instance.onConfigure();
    await instance.onConfigure();
    expect(loggerWarnSpy).toHaveBeenCalledTimes(2);
  });
});

describe('configuration and sampling edge cases', () => {
  it.each([undefined, 4, 3601, 5.5, Number.NaN])('should default invalid or omitted polling interval %s to 30 seconds', async (pollInterval) => {
    await instance.onShutdown();
    const pluginConfig = { ...config, pollInterval: pollInterval ?? 30, sysfsPath: '' };
    if (pollInterval === undefined) Reflect.deleteProperty(pluginConfig, 'pollInterval');
    instance = initializePlugin(matterbridge, log, pluginConfig);
    expect(instance.config).toBe(pluginConfig);
    expect(instance.config.pollInterval).toBe(30);
    expect(instance.config.sysfsPath).toBe('/sys');
    addMatterbridge(instance);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await instance.onStart();
    expect(state.read).toHaveBeenCalledExactlyOnceWith('/sys');
    state.sample.mockClear();
    await vi.advanceTimersByTimeAsync(29999);
    expect(state.sample).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(state.sample).toHaveBeenCalledOnce();
  });

  it('should register an unavailable reading and keep devices when unregister is disabled', async () => {
    instance.config.unregisterOnShutdown = false;
    state.read.mockResolvedValue([{ id: 'cpu0', name: 'Core 0', celsius: null }]);
    await instance.onStart('test');
    expect(instance.getDevices()[0].getAttribute(TemperatureMeasurement, 'measuredValue')).toBeNull();
    const devices = instance.getDevices();
    const unregister = vi.spyOn(instance, 'unregisterAllDevices');
    await instance.onShutdown();
    expect(unregister).not.toHaveBeenCalled();
    for (const device of devices) await device.delete();
    instance.config.unregisterOnShutdown = true;
  });

  it('should mark existing readings unavailable on non-Error sampling failures', async () => {
    await instance.onStart();
    state.sample.mockRejectedValue('sensor disconnected');
    expectedWarnings = ['Unable to read CPU temperatures: sensor disconnected'];
    await instance.onConfigure();
    await instance.onConfigure();
    expect(instance.getDevices().map((device) => device.getAttribute(TemperatureMeasurement, 'measuredValue'))).toEqual([null, null]);
  });

  it('should share an in-flight sample and discard its result during shutdown', async () => {
    let complete: (readings: []) => void = () => {};
    state.read.mockImplementation(
      async () =>
        new Promise<[]>((resolve) => {
          complete = resolve;
        }),
    );
    const starting = instance.onStart();
    await vi.waitFor(() => expect(state.read).toHaveBeenCalledOnce(), { interval: 1 });
    const configuring = instance.onConfigure();
    await vi.waitFor(() => expect(loggerInfoSpy).toHaveBeenCalledWith(info`Configuring platform ${bgBlue.white`${config.name}`}...`), { interval: 1 });
    const stopping = instance.onShutdown();
    complete([]);
    await Promise.all([starting, configuring, stopping]);
    expect(state.read).toHaveBeenCalledOnce();
    expect(instance.getDevices()).toHaveLength(0);
  });

  it('should log a failed scheduled update and continue polling', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await instance.onStart();
    const device = instance.getDevices()[0];
    const setAttribute = vi.spyOn(device, 'setAttribute').mockRejectedValueOnce(new Error('attribute unavailable')).mockRejectedValueOnce(new Error('attribute unavailable'));
    expectedWarnings = ['Unable to read CPU temperatures: attribute unavailable', 'CPU temperature update failed: Error: attribute unavailable'];
    await vi.advanceTimersByTimeAsync(5000);
    setAttribute.mockRestore();
    state.sample.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(state.sample).toHaveBeenCalledOnce();
  });
});

it('should use the current poll interval and retain the sources discovered at startup', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await instance.onStart();
  instance.config.pollInterval = 10;
  instance.config.sysfsPath = '/updated-sys';
  state.read.mockClear();
  state.sample.mockClear();
  await vi.advanceTimersByTimeAsync(5000);
  expect(state.sample).toHaveBeenCalledOnce();
  state.sample.mockClear();
  await vi.advanceTimersByTimeAsync(9999);
  expect(state.sample).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(state.sample).toHaveBeenCalledOnce();
  expect(state.read).not.toHaveBeenCalled();
});

it('should create devices only during startup and ignore new sensors during configure and polling', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await instance.onStart();
  const devices = instance.getDevices();
  const register = vi.spyOn(instance, 'registerDevice');
  const readings = [
    { id: 'cpu0', name: 'Core 0', celsius: 50 },
    { id: 'cpu1', name: 'Core 1', celsius: 55 },
    { id: 'cpu2', name: 'Core 2', celsius: 60 },
  ];
  state.read.mockClear();
  state.sample.mockResolvedValue(readings);
  await instance.onConfigure();
  await vi.advanceTimersByTimeAsync(5000);
  expect(register).not.toHaveBeenCalled();
  expect(state.read).not.toHaveBeenCalled();
  expect(instance.getDevices()).toEqual(devices);
  expect(devices.map((device) => device.getAttribute(TemperatureMeasurement, 'measuredValue'))).toEqual([5000, 5500]);
  state.read.mockResolvedValue(readings);
  await instance.onStart('rediscover');
  expect(register).toHaveBeenCalledOnce();
  expect(instance.getDevices()).toHaveLength(3);
});

it('should discard an in-flight update when shutdown begins', async () => {
  await instance.onStart();
  let complete: (readings: []) => void = () => {};
  state.sample.mockImplementation(
    async () =>
      new Promise<[]>((resolve) => {
        complete = resolve;
      }),
  );
  const configuring = instance.onConfigure();
  await vi.waitFor(() => expect(state.sample).toHaveBeenCalledOnce(), { interval: 1 });
  const stopping = instance.onShutdown();
  complete([]);
  await Promise.all([configuring, stopping]);
  expect(instance.getDevices()).toHaveLength(0);
});

it('should update known sensors with an unavailable value', async () => {
  await instance.onStart();
  state.sample.mockResolvedValue([{ id: 'cpu0', name: 'Core 0', celsius: null }]);
  await instance.onConfigure();
  expect(instance.getDevices().map((device) => device.getAttribute(TemperatureMeasurement, 'measuredValue'))).toEqual([null, null]);
});
