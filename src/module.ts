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

import { type BasePlatformConfig, MatterbridgeDynamicPlatform, MatterbridgeEndpoint, type PlatformMatterbridge, contactSensor, temperatureSensor } from 'matterbridge';
import type { AnsiLogger, LogLevel } from 'matterbridge/logger';
import { BooleanState, BridgedDeviceBasicInformation, TemperatureMeasurement } from 'matterbridge/matter/clusters';
import { isValidInteger, isValidNumber, isValidString } from 'matterbridge/utils';
import { bgBlue, info } from 'node-ansi-logger';

import { HistoryCache } from './history.js';
import { readMacosTemperatures } from './macos.js';
import { type CpuTemperature, readLinuxTemperatures, sampleCpuTemperatures, sensorSerial } from './temperatures.js';

/** Configuration for host CPU temperature discovery. */
export type HostHealthPlatformConfig = BasePlatformConfig & {
  whiteList: string[];
  blackList: string[];
  nodeLabels: Record<string, { name?: string }>;
  pollInterval: number;
  temperatureAlert: number;
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
  /** Active polling timer handle when scheduled. */
  private timer?: ReturnType<typeof setTimeout>;
  /** In-flight discovery or temperature refresh promise. */
  private pending?: Promise<void>;
  /** Whether polling and updates are currently stopped. */
  private stopped = true;
  /** Discovered CPU sensor sources retained for periodic sampling. */
  private readonly sources: CpuTemperature[] = [];
  /** Current host operating system platform identifier. */
  private readonly hostPlatform = platform();
  /** Whether a discovery or sampling error warning has already been logged. */
  private warned = false;
  /** Circular temperature history for each device mapped to its serial number. */
  readonly history = new Map<string, HistoryCache>();
  /** Periodic history persistence timer handle when scheduled. */
  private historyTimer?: ReturnType<typeof setInterval>;

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
    this.log.info(info`Initializing platform ${bgBlue.white`${this.config.name}`}...`);
    this.config.nodeLabels ??= {};
    this.config.pollInterval = isValidInteger(this.config.pollInterval, 5, 3600) ? this.config.pollInterval : 60;
    this.config.temperatureAlert = isValidNumber(this.config.temperatureAlert, 0, 150) ? this.config.temperatureAlert : 70;
    this.config.sysfsPath = isValidString(this.config.sysfsPath, 1) && this.config.sysfsPath.trim() ? this.config.sysfsPath : '/sys';
    this.log.info(info`Platform ${bgBlue.white`${this.config.name}`} initialized successfully`);
  }

  /**
   * Discover CPU sensors and start polling on supported hosts.
   * @param {string} [reason] Startup reason.
   * @returns {Promise<void>} Resolves when initial discovery finishes.
   */
  override async onStart(reason?: string): Promise<void> {
    this.log.info(info`Starting platform ${bgBlue.white`${this.config.name}`} with reason: ${reason ?? 'no reason provided'}...`);
    await this.ready;
    await this.clearSelect();
    if (this.hostPlatform !== 'linux' && this.hostPlatform !== 'darwin') {
      const message = `Host Health supports Linux and macOS only. No devices will be created on ${this.hostPlatform}.`;
      this.log.warn(message);
      this.wssSendSnackbarMessage(message, 0, 'warning');
      return;
    }
    this.stopped = false;
    await this.loadHistory();
    this.pending = this.createDevices();
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
    this.schedule();
    clearInterval(this.historyTimer);
    this.historyTimer = setInterval(() => void this.saveHistory(), 60 * 60 * 1000);
    this.historyTimer.unref();
    this.log.info(info`Platform ${bgBlue.white`${this.config.name}`} started successfully`);
  }

  /**
   * Refresh persisted attributes after Matterbridge configuration.
   * @returns {Promise<void>} Resolves when attributes are updated.
   */
  override async onConfigure(): Promise<void> {
    await super.onConfigure();
    this.log.info(info`Configuring platform ${bgBlue.white`${this.config.name}`}...`);
    if (!this.stopped) await this.refresh();
    await this.configureNodeLabels();
    this.log.info(info`Platform ${bgBlue.white`${this.config.name}`} configured successfully`);
  }

  /**
   * Apply node labels after the plugin configuration changes.
   * @param {HostHealthPlatformConfig} _config Updated configuration already assigned by Matterbridge.
   * @returns {Promise<void>} Resolves after configured node labels are processed.
   */
  override async onConfigChanged(_config: HostHealthPlatformConfig): Promise<void> {
    this.log.info(info`Changing configuration for platform ${bgBlue.white`${this.config.name}`}...`);
    this.config.nodeLabels ??= {};
    await this.configureNodeLabels();
    this.log.info(info`Platform ${bgBlue.white`${this.config.name}`} configuration changed successfully`);
  }

  /**
   * Update the logger level for the platform and all registered devices.
   * @param {LogLevel} logLevel New logger level.
   * @returns {Promise<void>} Resolves when the logger level has been updated.
   */
  // oxlint-disable-next-line typescript/require-await
  override async onChangeLoggerLevel(logLevel: LogLevel): Promise<void> {
    this.log.info(info`Changing logger level of platform ${bgBlue.white`${this.config.name}`} to ${logLevel}...`);
    this.log.logLevel = logLevel;
    for (const device of this.getDevices()) {
      device.log.logLevel = logLevel;
    }
    this.log.info(info`Platform ${bgBlue.white`${this.config.name}`} logger level changed successfully to ${logLevel}`);
  }

  /**
   * Stop polling and await any active read before shutdown.
   * @param {string} [reason] Shutdown reason.
   * @returns {Promise<void>} Resolves when cleanup finishes.
   */
  override async onShutdown(reason?: string): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.pending;
    if (this.historyTimer) {
      clearInterval(this.historyTimer);
      this.historyTimer = undefined;
      await this.saveHistory();
    }
    await super.onShutdown(reason);
    this.log.info(info`Shutting down platform ${bgBlue.white`${this.config.name}`} with reason: ${reason ?? 'no reason provided'}...`);
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
    this.sources.length = 0;
    this.log.info(info`Platform ${bgBlue.white`${this.config.name}`} shut down successfully`);
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
      const readings = this.hostPlatform === 'darwin' ? await readMacosTemperatures() : await readLinuxTemperatures(this.config.sysfsPath);
      if (this.stopped) return;
      if (!readings.length) {
        this.log.warn(
          this.hostPlatform === 'darwin'
            ? 'No CPU temperatures found. Check macOS Apple Silicon IOKit sensor availability.'
            : 'No CPU temperatures found. Check Linux sensor availability and sysfs permissions.',
        );
      }
      for (const reading of readings) {
        const serial = sensorSerial(`${hostname()}/${reading.id}`);
        if (this.getDeviceBySerialNumber(serial)) continue;
        const name = `${hostname()} ${reading.name}`;
        this.setSelectDevice(serial, name);
        if (!this.validateDevice([name, serial])) continue;
        const device = new MatterbridgeEndpoint(temperatureSensor, { id: serial })
          .createDefaultBridgedDeviceBasicInformationClusterServer(name.slice(0, 32), serial, this.matterbridge.aggregatorVendorId, 'Matterbridge', 'Host CPU Temperature')
          .createDefaultTemperatureMeasurementClusterServer(reading.celsius === null ? null : Math.round(reading.celsius * 100))
          .addRequiredClusters();
        device
          .addChildDeviceType('TemperatureAlert', contactSensor)
          .createDefaultBooleanStateClusterServer(reading.celsius === null || reading.celsius <= this.config.temperatureAlert)
          .addRequiredClusters();
        await this.registerDevice(device);
        await this.configureNodeLabels(device);
        this.sources.push(reading);
        this.addHistory(serial, reading.celsius);
      }
    } catch (error) {
      this.warnReadingError(error);
    }
  }

  /**
   * Apply configured node labels and log changes or invalid entries.
   * @param {MatterbridgeEndpoint} [device] Device to update; when omitted, process all configured devices.
   * @returns {Promise<void>} Resolves after processing all configured labels.
   */
  private async configureNodeLabels(device?: MatterbridgeEndpoint): Promise<void> {
    for (const [key, { name }] of Object.entries(this.config.nodeLabels)) {
      if (device && device.deviceName !== key) continue;
      if (!isValidString(name, 1, 32)) {
        this.log.warn(`Invalid node label for "${key}": name must be a string between 1 and 32 characters`);
        continue;
      }
      const target = device ?? this.getDeviceByName(key);
      if (!target) {
        this.log.warn(`Device "${key}" not found while configuring node label`);
        continue;
      }
      await target.setAttribute(BridgedDeviceBasicInformation, 'nodeLabel', name, this.log);
      this.log.info(`Set node label for "${key}" to "${name}"`);
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
      const values = new Map<string | undefined, number | null>(readings.map((reading) => [sensorSerial(`${hostname()}/${reading.id}`), reading.celsius]));
      for (const source of this.sources) {
        const serial = sensorSerial(`${hostname()}/${source.id}`);
        this.addHistory(serial, values.get(serial) ?? null);
      }
      for (const device of this.getDevices()) {
        const celsius = values.get(device.serialNumber);
        const valid = celsius !== null && celsius !== undefined;
        await device.setAttribute(TemperatureMeasurement, 'measuredValue', valid ? Math.round(celsius * 100) : null, this.log);
        for (const child of device.getChildEndpoints()) {
          await child.setAttribute(BooleanState, 'stateValue', !(valid && celsius > this.config.temperatureAlert), this.log);
        }
      }
    } catch (error) {
      this.warnReadingError(error);
      for (const device of this.getDevices()) {
        await device.setAttribute(TemperatureMeasurement, 'measuredValue', null, this.log);
        for (const child of device.getChildEndpoints()) {
          await child.setAttribute(BooleanState, 'stateValue', true, this.log);
        }
      }
    }
  }

  /**
   * Append a temperature sample to the device history, creating the history when missing.
   * @param {string} serial Device serial number.
   * @param {number | null} celsius Temperature in degrees Celsius or null when unavailable.
   * @returns {void} No return value.
   */
  private addHistory(serial: string, celsius: number | null): void {
    let history = this.history.get(serial);
    if (!history) this.history.set(serial, (history = new HistoryCache()));
    history.add({ timestamp: Date.now(), celsius });
  }

  /**
   * Load the persisted device histories from the platform context.
   * @returns {Promise<void>} Resolves when the histories are loaded.
   */
  private async loadHistory(): Promise<void> {
    this.history.clear();
    if (!this.context) return;
    try {
      const stored = await this.context.get<Record<string, unknown>>('history', {});
      for (const [serial, entries] of Object.entries(stored)) {
        const history = new HistoryCache();
        history.load(entries);
        this.history.set(serial, history);
      }
      this.log.debug(`Loaded history for ${this.history.size} devices`);
    } catch (error) {
      this.log.warn(`Unable to load history: ${String(error)}`);
    }
  }

  /**
   * Persist the device histories to the platform context.
   * @returns {Promise<void>} Resolves when the histories are saved.
   */
  private async saveHistory(): Promise<void> {
    if (!this.context) return;
    try {
      await this.context.set('history', Object.fromEntries([...this.history].map(([serial, history]) => [serial, history.get()])));
      this.log.debug(`Saved history for ${this.history.size} devices`);
    } catch (error) {
      this.log.warn(`Unable to save history: ${String(error)}`);
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
