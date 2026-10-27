/**
 * @file src/temperatures.ts
 * @description Host CPU temperature discovery and sampling.
 * @author Luca Liguori
 * @created 2026-10-27
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

import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

const cpuDriver = /^(coretemp|k10temp|k8temp|zenpower|cpu_thermal|cpu-thermal|bcm2835_thermal|raspberrypi.*|peci_cputemp|cpu.*temp)$/i;
const cpuLabel = /\b(cpu|core|package|tctl|tdie|tccd\d*)\b/i;

/** A CPU temperature reading in degrees Celsius. */
export interface CpuTemperature {
  id: string;
  name: string;
  celsius: number | null;
  source?: string;
}

/**
 * Validate a temperature against the Matter measured-value range.
 * @param {string} text Raw sensor value.
 * @param {number} divisor Unit conversion divisor.
 * @returns {number | null} Temperature in Celsius, or null when unavailable.
 */
function parseTemperature(text: string, divisor: number): number | null {
  if (!text.trim()) return null;
  const value = Number(text.trim()) / divisor;
  return Number.isFinite(value) && value >= -273.15 && value <= 327.67 ? value : null;
}

/**
 * Read an optional sysfs text file.
 * @param {string} file File path.
 * @returns {Promise<string>} Trimmed contents or an empty string.
 */
async function readText(file: string): Promise<string> {
  return readFile(file, 'utf8')
    .then((text) => text.trim())
    .catch(() => '');
}

/**
 * List an optional sysfs directory.
 * @param {string} directory Directory path.
 * @returns {Promise<string[]>} Sorted entries, or an empty list.
 */
async function list(directory: string): Promise<string[]> {
  return readdir(directory)
    .then((entries) => entries.toSorted())
    .catch(() => []);
}

/**
 * Discover CPU hwmon channels, falling back to CPU thermal zones.
 * @param {string} root Host sysfs mount root.
 * @returns {Promise<CpuTemperature[]>} All detected CPU channels, including unavailable readings.
 */
export async function readLinuxTemperatures(root: string): Promise<CpuTemperature[]> {
  const sensors: CpuTemperature[] = [];
  const seen = new Set<string>();
  for (const entry of await list(path.join(root, 'class/hwmon'))) {
    const directory = path.join(root, 'class/hwmon', entry);
    const driver = await readText(path.join(directory, 'name'));
    // Resolve symlinks to avoid depending on the boot-dependent hwmon index.
    const location = await realpath(directory).catch(() => directory);
    const identity = location.replace(/[\\/]hwmon[\\/]hwmon\d+$/, '');
    for (const file of (await list(directory)).filter((name) => /^temp\d+_input$/.test(name))) {
      const label = await readText(path.join(directory, file.replace('_input', '_label')));
      if (!cpuDriver.test(driver) && !cpuLabel.test(label)) continue;
      const source = await realpath(path.join(directory, file)).catch(() => path.join(directory, file));
      if (seen.has(source)) continue;
      seen.add(source);
      sensors.push({
        id: path.join(identity, file),
        name: `${driver || 'CPU'} ${label || file.replace('_input', '')}`,
        celsius: parseTemperature(await readText(source), 1000),
        source,
      });
    }
  }
  // CPU thermal zones often duplicate hwmon channels; use them only as a fallback.
  if (sensors.length) return sensors;
  for (const entry of (await list(path.join(root, 'class/thermal'))).filter((name) => /^thermal_zone\d+$/.test(name))) {
    const directory = path.join(root, 'class/thermal', entry);
    const type = await readText(path.join(directory, 'type'));
    if (!/cpu|x86_pkg_temp|soc_thermal|bcm2835/i.test(type)) continue;
    sensors.push({
      id: `thermal/${type}/${entry}`,
      name: `${type} ${entry}`,
      celsius: parseTemperature(await readText(path.join(directory, 'temp')), 1000),
      source: path.join(directory, 'temp'),
    });
  }
  return sensors;
}

/**
 * Derive a short stable Matter serial number from a sensor identity.
 * @param {string} identity Host and sensor identity.
 * @returns {string} Stable serial number within Matter length limits.
 */
export function sensorSerial(identity: string): string {
  return `cpu-${createHash('sha256').update(identity).digest('hex').slice(0, 24)}`;
}

/**
 * Update previously discovered channels without enumerating hardware.
 * @param {CpuTemperature[]} sensors Sources selected during startup.
 * @returns {Promise<CpuTemperature[]>} Updated readings for the known sources only.
 */
export async function sampleCpuTemperatures(sensors: CpuTemperature[]): Promise<CpuTemperature[]> {
  return Promise.all(sensors.map(async (sensor) => ({ ...sensor, celsius: sensor.source ? parseTemperature(await readText(sensor.source), 1000) : null })));
}
