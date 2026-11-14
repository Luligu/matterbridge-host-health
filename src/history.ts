/**
 * @file src/history.ts
 * @description Circular temperature history for host health devices.
 * @author Luca Liguori
 * @created 2026-11-14
 * @version 1.0.0
 * @license Apache-2.0
 *
 * Copyright 2026, 2027 Luca Liguori.
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

/** A temperature sample with its timestamp in milliseconds since the epoch. */
export interface HistoryEntry {
  timestamp: number;
  celsius: number | null;
}

/**
 * Stores the most recent temperature samples in a fixed-capacity circular buffer.
 */
export class HistoryCache {
  readonly #capacity: number;
  readonly #entries: HistoryEntry[] = [];
  #next = 0;

  /**
   * Creates an empty history.
   *
   * @param {number} capacity - Maximum number of entries to retain; defaults to 2880 (48 hours at the default 60 seconds poll interval).
   * @throws {RangeError} If capacity is not a positive safe integer.
   */
  constructor(capacity = 2880) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError('History capacity must be a positive safe integer.');
    }
    this.#capacity = capacity;
  }

  /**
   * Adds an entry, overwriting the oldest entry when the history is full.
   *
   * @param {HistoryEntry} entry - Entry to copy into the history.
   * @returns {void}
   */
  public add(entry: HistoryEntry): void {
    this.#entries[this.#next] = { ...entry };
    this.#next = (this.#next + 1) % this.#capacity;
  }

  /**
   * Removes all retained entries without changing capacity.
   *
   * @returns {void}
   */
  public clear(): void {
    this.#entries.length = 0;
    this.#next = 0;
  }

  /**
   * Returns a snapshot of the entries from oldest to newest.
   *
   * @returns {HistoryEntry[]} Copies of all retained entries.
   */
  public get(): HistoryEntry[] {
    return [...this.#entries.slice(this.#next), ...this.#entries.slice(0, this.#next)].map((entry) => ({ ...entry }));
  }

  /**
   * Replaces the history with valid entries, keeping the newest ones when they exceed capacity.
   *
   * @param {unknown} entries - Persisted entries ordered from oldest to newest.
   * @returns {void}
   */
  public load(entries: unknown): void {
    this.clear();
    if (!Array.isArray(entries)) return;
    for (const entry of entries as unknown[]) {
      if (typeof entry !== 'object' || entry === null || !('timestamp' in entry) || !('celsius' in entry)) continue;
      const { timestamp, celsius } = entry;
      if (typeof timestamp !== 'number' || (celsius !== null && typeof celsius !== 'number')) continue;
      this.add({ timestamp, celsius });
    }
  }
}
