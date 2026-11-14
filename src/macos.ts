/**
 * @file src/macos.ts
 * @description macOS CPU/SoC temperature discovery and sampling via IOKit HID thermal sensors.
 * @author Luca Liguori
 * @created 2026-11-14
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026, 2027, 2028 Luca Liguori.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { CpuTemperature } from './temperatures.js';

/** CoreFoundation UTF-8 string encoding constant. */
const kCFStringEncodingUTF8 = 0x08000100;
/** CoreFoundation signed 32-bit integer number type. */
const kCFNumberSInt32Type = 3;
/** Apple Vendor HID usage page for internal hardware sensors. */
const kIOHIDVendorUsagePage = 0xff00;
/** HID usage ID for temperature sensors under the Apple Vendor usage page. */
const kIOHIDTemperatureUsage = 5;
/** IOKit HID event type for temperature readings (`kIOHIDEventTypeTemperature`). */
const kIOHIDEventTypeTemperature = 15;
/** IOKit HID event field for temperature level (`kIOHIDEventTypeTemperature << 16`, written without bitwise shift for lint). */
const kIOHIDEventFieldTemperatureLevel = kIOHIDEventTypeTemperature * 65536;
/** Matches Apple Silicon CPU/SoC die sensor names while excluding calibration (`tcal`) and bogus (`tdev`) channels. */
const macosCpuSensor = /\b(tdie\d+|soc mtr|pacc mtr|eacc mtr)\b/i;

/** Opaque CoreFoundation / IOKit reference pointer managed via `CFRelease`. */
type CFRef = unknown;

/** Bound CoreFoundation and IOKit FFI functions loaded through `koffi`. */
interface IOKitBindings {
  /** Create a CoreFoundation string from a UTF-8 C string. */
  CFStringCreateWithCString: (alloc: CFRef, cStr: string, encoding: number) => CFRef;
  /** Copy a CoreFoundation string into a UTF-8 byte buffer. */
  CFStringGetCString: (theString: CFRef, buffer: Buffer, bufferSize: number, encoding: number) => boolean;
  /** Create a CoreFoundation number from a 32-bit signed integer. */
  CFNumberCreate: (alloc: CFRef, theType: number, valuePtr: Int32Array) => CFRef;
  /** Create an immutable CoreFoundation dictionary from key and value pointer arrays. */
  CFDictionaryCreate: (alloc: CFRef, keys: CFRef[], values: CFRef[], numValues: number, keyCallBacks: CFRef, valueCallBacks: CFRef) => CFRef;
  /** Return the number of elements in a CoreFoundation array. */
  CFArrayGetCount: (theArray: CFRef) => number;
  /** Return the borrowed element pointer at `idx` in a CoreFoundation array. */
  CFArrayGetValueAtIndex: (theArray: CFRef, idx: number) => CFRef;
  /** Release a CoreFoundation object reference. */
  CFRelease: (cf: CFRef) => void;
  /** Create an unprivileged IOHID event system client. */
  IOHIDEventSystemClientCreate: (allocator: CFRef) => CFRef;
  /** Restrict enumerated HID services using a CoreFoundation matching dictionary. */
  IOHIDEventSystemClientSetMatching: (client: CFRef, match: CFRef) => void;
  /** Copy the array of matched HID service clients. */
  IOHIDEventSystemClientCopyServices: (client: CFRef) => CFRef;
  /** Copy a named property from an `IOHIDServiceClient`. */
  IOHIDServiceClientCopyProperty: (service: CFRef, key: CFRef) => CFRef;
  /** Copy the latest HID event of the given type from a service client. */
  IOHIDServiceClientCopyEvent: (service: CFRef, type: number, options: number, timeout: number) => CFRef;
  /** Extract a floating-point field value from an `IOHIDEvent`. */
  IOHIDEventGetFloatValue: (event: CFRef, field: number) => number;
}

/** Cached FFI bindings (`undefined` = unloaded, `null` = unavailable). */
let bindings: IOKitBindings | null | undefined;

/**
 * Load CoreFoundation and IOKit FFI bindings lazily on macOS.
 * @returns {Promise<IOKitBindings | null>} Bound framework functions, or null when unavailable.
 */
async function loadBindings(): Promise<IOKitBindings | null> {
  if (bindings !== undefined) return bindings;
  try {
    const { default: koffi } = await import('koffi');
    const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
    const iokit = koffi.load('/System/Library/Frameworks/IOKit.framework/IOKit');
    bindings = {
      CFStringCreateWithCString: cf.func('void *CFStringCreateWithCString(void *alloc, const char *cStr, uint32_t encoding)'),
      CFStringGetCString: cf.func('bool CFStringGetCString(void *theString, _Out_ uint8_t *buffer, long bufferSize, uint32_t encoding)'),
      CFNumberCreate: cf.func('void *CFNumberCreate(void *alloc, int theType, const int32_t *valuePtr)'),
      CFDictionaryCreate: cf.func('void *CFDictionaryCreate(void *alloc, void **keys, void **values, long numValues, void *keyCallBacks, void *valueCallBacks)'),
      CFArrayGetCount: cf.func('long CFArrayGetCount(void *theArray)'),
      CFArrayGetValueAtIndex: cf.func('void *CFArrayGetValueAtIndex(void *theArray, long idx)'),
      CFRelease: cf.func('void CFRelease(void *cf)'),
      IOHIDEventSystemClientCreate: iokit.func('void *IOHIDEventSystemClientCreate(void *allocator)'),
      IOHIDEventSystemClientSetMatching: iokit.func('void IOHIDEventSystemClientSetMatching(void *client, void *match)'),
      IOHIDEventSystemClientCopyServices: iokit.func('void *IOHIDEventSystemClientCopyServices(void *client)'),
      IOHIDServiceClientCopyProperty: iokit.func('void *IOHIDServiceClientCopyProperty(void *service, void *key)'),
      IOHIDServiceClientCopyEvent: iokit.func('void *IOHIDServiceClientCopyEvent(void *service, int64_t type, int32_t options, int64_t timeout)'),
      IOHIDEventGetFloatValue: iokit.func('double IOHIDEventGetFloatValue(void *event, uint32_t field)'),
    };
  } catch {
    bindings = null;
  }
  return bindings;
}

/**
 * Validate a macOS temperature reading against the Matter measured-value range.
 * @param {number} value Temperature in degrees Celsius.
 * @returns {number | null} Temperature in Celsius, or null when out of range.
 */
function sanitizeTemperature(value: number): number | null {
  return Number.isFinite(value) && value >= -273.15 && value <= 327.67 ? value : null;
}

/**
 * Discover and read Apple Silicon CPU/SoC die temperature sensors via IOKit HID.
 * @returns {Promise<CpuTemperature[]>} Deduplicated CPU/SoC temperature readings.
 */
export async function readMacosTemperatures(): Promise<CpuTemperature[]> {
  const api = await loadBindings();
  if (!api) return [];

  const kPage = api.CFStringCreateWithCString(null, 'PrimaryUsagePage', kCFStringEncodingUTF8);
  const kUsage = api.CFStringCreateWithCString(null, 'PrimaryUsage', kCFStringEncodingUTF8);
  const kProduct = api.CFStringCreateWithCString(null, 'Product', kCFStringEncodingUTF8);
  const vPage = api.CFNumberCreate(null, kCFNumberSInt32Type, new Int32Array([kIOHIDVendorUsagePage]));
  const vUsage = api.CFNumberCreate(null, kCFNumberSInt32Type, new Int32Array([kIOHIDTemperatureUsage]));
  const match = api.CFDictionaryCreate(null, [kPage, kUsage], [vPage, vUsage], 2, null, null);
  const client = api.IOHIDEventSystemClientCreate(null);
  const sensors: CpuTemperature[] = [];
  const seen = new Set<string>();
  const buffer = Buffer.alloc(256);

  try {
    if (!client) return [];
    api.IOHIDEventSystemClientSetMatching(client, match);
    const services = api.IOHIDEventSystemClientCopyServices(client);
    if (!services) return [];
    try {
      const count = api.CFArrayGetCount(services);
      for (let i = 0; i < count; i++) {
        // Borrowed reference from CFArray: do not CFRelease `service`.
        const service = api.CFArrayGetValueAtIndex(services, i);
        const nameRef = api.IOHIDServiceClientCopyProperty(service, kProduct);
        if (!nameRef) continue;
        let name = '';
        try {
          if (api.CFStringGetCString(nameRef, buffer, buffer.length, kCFStringEncodingUTF8)) {
            name = buffer.toString('utf8').split('\0')[0];
          }
        } finally {
          api.CFRelease(nameRef);
        }
        // Apple Silicon exposes multiple PMU instances with identical Product names; keep the first per name.
        if (!macosCpuSensor.test(name) || seen.has(name)) continue;
        seen.add(name);
        const event = api.IOHIDServiceClientCopyEvent(service, kIOHIDEventTypeTemperature, 0, 0);
        let celsius: number | null = null;
        if (event) {
          try {
            celsius = sanitizeTemperature(api.IOHIDEventGetFloatValue(event, kIOHIDEventFieldTemperatureLevel));
          } finally {
            api.CFRelease(event);
          }
        }
        sensors.push({ id: `darwin/${name}`, name, celsius });
      }
    } finally {
      api.CFRelease(services);
    }
  } finally {
    if (client) api.CFRelease(client);
    api.CFRelease(match);
    api.CFRelease(vPage);
    api.CFRelease(vUsage);
    api.CFRelease(kPage);
    api.CFRelease(kUsage);
    api.CFRelease(kProduct);
  }
  return sensors;
}
