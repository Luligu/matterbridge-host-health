/**
 * @file vitest/history.test.ts
 * @description Circular temperature history tests.
 * @author Luca Liguori
 */

import { HistoryCache } from '../src/history.js';

describe('HistoryCache', () => {
  it('should reject invalid capacities', () => {
    expect(() => new HistoryCache(0)).toThrow(RangeError);
    expect(() => new HistoryCache(1.5)).toThrow(RangeError);
  });

  it('should overwrite the oldest entries and return them from oldest to newest', () => {
    const history = new HistoryCache(2);
    history.add({ timestamp: 1, celsius: 40 });
    history.add({ timestamp: 2, celsius: null });
    history.add({ timestamp: 3, celsius: 42 });
    expect(history.get()).toEqual([
      { timestamp: 2, celsius: null },
      { timestamp: 3, celsius: 42 },
    ]);
    history.clear();
    expect(history.get()).toEqual([]);
  });

  it('should load only valid entries and keep the newest ones', () => {
    const history = new HistoryCache(2);
    history.load([
      { timestamp: 1, celsius: 40 },
      null,
      { timestamp: 'x', celsius: 1 },
      { timestamp: 2, celsius: '1' },
      { timestamp: 3, celsius: null },
      { timestamp: 4, celsius: 44 },
    ]);
    expect(history.get()).toEqual([
      { timestamp: 3, celsius: null },
      { timestamp: 4, celsius: 44 },
    ]);
    history.load('invalid');
    expect(history.get()).toEqual([]);
  });
});
