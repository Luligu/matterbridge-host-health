/**
 * @file src/module.ts
 * @description Matterbridge host CPU temperature platform.
 * @author Luca Liguori
 * @created 2025-06-15
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2025, 2026, 2027 Luca Liguori.
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

import { hostname, platform } from 'node:os';

import { type BasePlatformConfig, MatterbridgeDynamicPlatform, MatterbridgeEndpoint, type PlatformMatterbridge, temperatureSensor } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';
import { TemperatureMeasurement } from 'matterbridge/matter/clusters';

import { type CpuTemperature, readLinuxTemperatures, sampleCpuTemperatures, sensorSerial } from './temperatures.js';

/** Configuration for host CPU temperature discovery. */
export type HostHealthPlatformConfig = BasePlatformConfig & {
  whiteList: string[];
  blackList: string[];
  pollInterval: number;
  sysfsPath: string;
};

/**
 * Initialize the host health platform.
 * @param {PlatformMatterbridge} matterbridge Matterbridge host.
 * @param {AnsiLogger} log Plugin logger.
 * @param {HostHealthPlatformConfig} config Plugin configuration.
 * @returns {HostHealthPlatform} Host health platform.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: HostHealthPlatformConfig): HostHealthPlatform {
  return new HostHealthPlatform(matterbridge, log, config);
}

/** Exposes discovered host CPU readings as bridged temperature sensors. */
export class HostHealthPlatform extends MatterbridgeDynamicPlatform {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: Promise<void>;
  private stopped = true;
  private readonly sensors = new Map<string, MatterbridgeEndpoint>();
  private readonly sources: CpuTemperature[] = [];
  private readonly hostPlatform = platform();
  private warned = false;

  /**
   * Create the platform and validate configuration.
   * @param {PlatformMatterbridge} matterbridge Matterbridge host.
   * @param {AnsiLogger} log Plugin logger.
   * @param {HostHealthPlatformConfig} config Plugin configuration.
   */
  constructor(
    matterbridge: PlatformMatterbridge,
    log: AnsiLogger,
    override config: HostHealthPlatformConfig,
  ) {
    super(matterbridge, log, config);
    if (!this.verifyMatterbridgeVersion('3.11.0')) throw new Error('This plugin requires Matterbridge >= 3.11.0.');
    this.log.info(`Initializing platform ${this.config.name}...`);
    const seconds = this.config.pollInterval ?? 30;
    this.config.pollInterval = Number.isInteger(seconds) && seconds >= 5 && seconds <= 3600 ? seconds : 30;
    this.config.sysfsPath = typeof this.config.sysfsPath === 'string' && this.config.sysfsPath.trim() ? this.config.sysfsPath : '/sys';
    this.log.info(`Platform ${this.config.name} initialized successfully`);
  }

  /**
   * Discover CPU sensors and start polling on supported hosts.
   * @param {string} [reason] Startup reason.
   * @returns {Promise<void>} Resolves when initial discovery finishes.
   */
  override async onStart(reason?: string): Promise<void> {
    this.log.info(`Starting platform ${this.config.name} with reason: ${reason ?? 'no reason provided'}...`);
    await this.ready;
    await this.clearSelect();
    if (this.hostPlatform !== 'linux') {
      const message = `Host Health supports Linux only. No devices will be created on ${this.hostPlatform}.`;
      this.log.warn(message);
      this.wssSendSnackbarMessage(message, 0, 'warning');
      return;
    }
    this.stopped = false;
    this.pending = this.createDevices();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
    this.schedule();
    this.log.info(`Platform ${this.config.name} started successfully`);
  }

  /**
   * Refresh persisted attributes after Matterbridge configuration.
   * @returns {Promise<void>} Resolves when attributes are updated.
   */
  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info(`Configuring platform ${this.config.name}...`);
    if (!this.stopped) await this.refresh();
    this.log.info(`Platform ${this.config.name} configured successfully`);
  }

  /**
   * Stop polling and await any active read before shutdown.
   * @param {string} [reason] Shutdown reason.
   * @returns {Promise<void>} Resolves when cleanup finishes.
   */
  override async onShutdown(reason?: string): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.pending;
    await super.onShutdown(reason);
    this.log.info(`Shutting down platform ${this.config.name} with reason: ${reason ?? 'no reason provided'}...`);
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
    this.sensors.clear();
    this.sources.length = 0;
    this.log.info(`Platform ${this.config.name} shut down successfully`);
  }

  /**
   * Schedule the next temperature refresh using the polling interval in seconds.
   * Skip scheduling when stopped and reschedule after each refresh finishes.
   * @returns {void} No return value.
   */
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.refresh()
        .catch((error: unknown) => this.log.warn(`CPU temperature update failed: ${String(error)}`))
        .finally(() => this.schedule());
    }, this.config.pollInterval * 1000);
    this.timer.unref();
  }

  /**
   * Discover CPU sensors and register selected temperature devices.
   * Retain registered sensor sources for polling and report discovery or registration errors.
   * @returns {Promise<void>} Resolves when device creation or error reporting finishes.
   */
  private async createDevices(): Promise<void> {
    try {
      const readings = await readLinuxTemperatures(this.config.sysfsPath);
      if (this.stopped) return;
      if (!readings.length) {
        this.log.warn('No CPU temperatures found. Check Linux sensor availability and sysfs permissions.');
      }
      for (const reading of readings) {
        const serial = sensorSerial(`${hostname()}/${reading.id}`);
        if (this.sensors.has(serial)) continue;
        const name = `${hostname()} ${reading.name}`;
        this.setSelectDevice(serial, name);
        if (!this.validateDevice([name, serial])) continue;
        const device = new MatterbridgeEndpoint(temperatureSensor, { id: serial })
          .createDefaultBridgedDeviceBasicInformationClusterServer(name.slice(0, 32), serial, this.matterbridge.aggregatorVendorId, 'Matterbridge', 'Host CPU Temperature')
          .createDefaultTemperatureMeasurementClusterServer(reading.celsius === null ? null : Math.round(reading.celsius * 100))
          .addRequiredClusters();
        await this.registerDevice(device);
        this.sensors.set(serial, device);
        this.sources.push(reading);
      }
    } catch (error) {
      this.warnReadingError(error);
    }
  }

  /**
   * Await the active temperature update or start one when none is pending.
   * @returns {Promise<void>} Resolves when the shared update finishes.
   */
  private async refresh(): Promise<void> {
    this.pending ??= this.updateTemperatures();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  /**
   * Sample saved sensor sources and update Matter attributes in hundredths of a degree Celsius.
   * Use null for unavailable readings and mark all devices unavailable after an update error.
   * @returns {Promise<void>} Resolves when temperature attributes or error fallback values are updated.
   */
  private async updateTemperatures(): Promise<void> {
    try {
      const readings = await sampleCpuTemperatures(this.sources);
      if (this.stopped) return;
      const values = new Map(readings.map((reading) => [sensorSerial(`${hostname()}/${reading.id}`), reading.celsius]));
      for (const [serial, device] of this.sensors) {
        const celsius = values.get(serial);
        await device.setAttribute(TemperatureMeasurement, 'measuredValue', celsius === null || celsius === undefined ? null : Math.round(celsius * 100), this.log);
      }
    } catch (error) {
      this.warnReadingError(error);
      for (const device of this.sensors.values()) await device.setAttribute(TemperatureMeasurement, 'measuredValue', null, this.log);
    }
  }

  /**
   * Log the first temperature discovery or update error for this platform instance.
   * @param {unknown} error Failure to describe in the warning.
   * @returns {void} No return value.
   */
  private warnReadingError(error: unknown): void {
    if (this.warned) return;
    this.log.warn(`Unable to read CPU temperatures: ${error instanceof Error ? error.message : String(error)}`);
    this.warned = true;
  }
}
