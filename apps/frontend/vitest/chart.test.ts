/**
 * @file apps/frontend/vitest/chart.test.ts
 * @description Tests for the temperature chart geometry.
 * @author Luligu
 */

import { describe, expect, it } from 'vitest';

import { buildChart } from '../src/chart.js';

describe('buildChart', () => {
  it('should return undefined when there are no valid readings', () => {
    expect(buildChart([], 100, 100)).toBeUndefined();
    expect(buildChart([{ timestamp: 1, celsius: null }], 100, 100)).toBeUndefined();
  });

  it('should scale readings and break the line on null readings', () => {
    const chart = buildChart(
      [
        { timestamp: 0, celsius: 41 },
        { timestamp: 50, celsius: null },
        { timestamp: 75, celsius: 49 },
        { timestamp: 100, celsius: 45 },
      ],
      100,
      100,
    );
    expect(chart).toEqual({ path: 'M0.0,90.0 M75.0,10.0 L100.0,50.0', minC: 40, maxC: 50, minT: 0, maxT: 100 });
  });

  it('should center a single reading', () => {
    expect(buildChart([{ timestamp: 5, celsius: 40 }], 100, 100)?.path).toBe('M50.0,50.0');
  });
});
