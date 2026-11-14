/** A temperature sample returned by the device-history API. */
export interface HistoryEntry {
  timestamp: number;
  celsius: number | null;
}

/** A registered device returned by the devices API. */
export interface DeviceInfo {
  serial: string;
  name: string;
  celsius: number | null;
  timestamp: number | null;
}

/** Scaled chart geometry for a temperature history. */
export interface ChartGeometry {
  /** SVG path data; gaps (null readings) start a new segment. */
  path: string;
  minC: number;
  maxC: number;
  minT: number;
  maxT: number;
}

/**
 * Builds the SVG path and axis bounds for a temperature history.
 *
 * @param {HistoryEntry[]} entries - Samples ordered from oldest to newest.
 * @param {number} width - Plot width in SVG units.
 * @param {number} height - Plot height in SVG units.
 * @returns {ChartGeometry | undefined} The geometry, or undefined when there are no valid readings.
 */
export function buildChart(entries: HistoryEntry[], width: number, height: number): ChartGeometry | undefined {
  const valid = entries.filter((entry): entry is { timestamp: number; celsius: number } => entry.celsius !== null);
  if (!valid.length) return undefined;
  const values = valid.map((entry) => entry.celsius);
  const minC = Math.floor(Math.min(...values) - 1);
  const maxC = Math.ceil(Math.max(...values) + 1);
  const minT = entries[0].timestamp;
  const maxT = entries[entries.length - 1].timestamp;
  const x = (t: number) => (maxT === minT ? width / 2 : ((t - minT) / (maxT - minT)) * width);
  const y = (c: number) => height - ((c - minC) / (maxC - minC)) * height;
  let path = '';
  let move = true;
  for (const entry of entries) {
    if (entry.celsius === null) {
      move = true;
      continue;
    }
    path += `${move ? 'M' : 'L'}${x(entry.timestamp).toFixed(1)},${y(entry.celsius).toFixed(1)} `;
    move = false;
  }
  return { path: path.trim(), minC, maxC, minT, maxT };
}
