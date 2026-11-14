/**
 * @file vitest/macos.test.ts
 * @description Tests for macOS IOKit HID temperature discovery and sampling.
 * @author Luca Liguori
 */

import type { CpuTemperature } from '../src/temperatures.js';

const state = vi.hoisted(() => ({
  loadError: false,
  client: {} as unknown,
  services: [] as { name: string | null; unreadable?: boolean; hasEvent?: boolean; value?: number }[],
}));

vi.mock('koffi', () => ({
  default: {
    load: (): { func: (sig: string) => unknown } => {
      if (state.loadError) throw new Error('koffi load failed');
      return {
        func: (sig: string) => {
          if (sig.includes('CFStringCreateWithCString')) return (_a: unknown, s: string) => ({ str: s });
          if (sig.includes('CFStringGetCString')) {
            return (ref: { str?: string }, buf: Buffer) => {
              if (!ref.str) return false;
              buf.fill(0);
              buf.write(ref.str, 0, 'utf8');
              return true;
            };
          }
          if (sig.includes('CFNumberCreate')) return (_a: unknown, _t: unknown, arr: Int32Array) => ({ num: arr[0] });
          if (sig.includes('CFDictionaryCreate')) return () => ({ dict: true });
          if (sig.includes('CFArrayGetCount')) return (arr: unknown[]) => arr.length;
          if (sig.includes('CFArrayGetValueAtIndex')) return (arr: unknown[], idx: number) => arr[idx];
          if (sig.includes('CFRelease')) return () => {};
          if (sig.includes('IOHIDEventSystemClientCreate')) return () => state.client;
          if (sig.includes('IOHIDEventSystemClientSetMatching')) return () => {};
          if (sig.includes('IOHIDEventSystemClientCopyServices')) return () => state.services;
          if (sig.includes('IOHIDServiceClientCopyProperty')) {
            return (svc: { name: string | null; unreadable?: boolean }) => {
              if (svc.name === null) return null;
              return svc.unreadable ? {} : { str: svc.name };
            };
          }
          if (sig.includes('IOHIDServiceClientCopyEvent')) {
            return (svc: { hasEvent?: boolean; value?: number }) => (svc.hasEvent === false ? null : { value: svc.value ?? 0 });
          }
          if (sig.includes('IOHIDEventGetFloatValue')) return (ev: { value: number }) => ev.value;
          return () => null;
        },
      };
    },
  },
}));

describe('macOS IOKit temperature discovery', () => {
  beforeEach(() => {
    vi.resetModules();
    state.loadError = false;
    state.client = {};
    state.services = [];
  });

  it('should return an empty array when koffi cannot be loaded', async () => {
    state.loadError = true;
    const { readMacosTemperatures } = await import('../src/macos.js');
    expect(await readMacosTemperatures()).toEqual([]);
    expect(await readMacosTemperatures()).toEqual([]);
  });

  it('should return an empty array when client or services are null', async () => {
    const { readMacosTemperatures } = await import('../src/macos.js');
    state.client = null;
    expect(await readMacosTemperatures()).toEqual([]);
    state.client = {};
    state.services = null as unknown as [];
    expect(await readMacosTemperatures()).toEqual([]);
  });

  it('should filter, deduplicate, and sanitize macOS CPU/SoC sensors', async () => {
    const { readMacosTemperatures } = await import('../src/macos.js');
    state.services = [
      { name: null },
      { name: 'ignored', unreadable: true },
      { name: 'PMU tdev3', value: -9201 },
      { name: 'PMU tdie3', value: 36.5 },
      { name: 'PMU tdie3', value: 37.0 },
      { name: 'PMU tdie4', value: -9201 },
      { name: 'PMU tdie5', hasEvent: false },
      { name: 'SOC MTR Temp Sensor0', value: 41.25 },
    ];
    const expected: CpuTemperature[] = [
      { id: 'darwin/PMU tdie3', name: 'PMU tdie3', celsius: 36.5 },
      { id: 'darwin/PMU tdie4', name: 'PMU tdie4', celsius: null },
      { id: 'darwin/PMU tdie5', name: 'PMU tdie5', celsius: null },
      { id: 'darwin/SOC MTR Temp Sensor0', name: 'SOC MTR Temp Sensor0', celsius: 41.25 },
    ];
    expect(await readMacosTemperatures()).toEqual(expected);
  });
});
