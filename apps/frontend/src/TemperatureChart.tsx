import { Box, Card, CardContent, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

import { buildChart, type DeviceInfo, type HistoryEntry } from './chart.ts';

const WIDTH = 600;
const HEIGHT = 200;
const PAD_LEFT = 40;
const PAD_BOTTOM = 20;

/**
 * Formats a timestamp as a local time string.
 *
 * @param {number} timestamp - Milliseconds since the epoch.
 * @returns {string} The formatted time.
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Card with the temperature history graph of a device.
 *
 * @param {object} props - The component props.
 * @param {DeviceInfo} props.device - The device to chart.
 * @param {HistoryEntry[]} props.entries - The device temperature history.
 * @returns {JSX.Element} The rendered card.
 */
export function TemperatureChart({ device, entries }: { device: DeviceInfo; entries: HistoryEntry[] }) {
  const theme = useTheme();
  const chart = buildChart(entries, WIDTH - PAD_LEFT, HEIGHT - PAD_BOTTOM);

  return (
    <Card variant="outlined">
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography variant="h6">{device.name}</Typography>
          <Typography variant="h6" color="primary">
            {device.celsius === null ? '—' : `${device.celsius.toFixed(1)} °C`}
          </Typography>
        </Box>
        {!chart && <Typography color="text.secondary">No temperature data yet.</Typography>}
        {chart && (
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%">
            <title>{`Temperature history of ${device.name}`}</title>
            <g fill={theme.palette.text.secondary} fontSize={11}>
              <text x={PAD_LEFT - 4} y={10} textAnchor="end">
                {chart.maxC}°
              </text>
              <text x={PAD_LEFT - 4} y={HEIGHT - PAD_BOTTOM} textAnchor="end">
                {chart.minC}°
              </text>
              <text x={PAD_LEFT} y={HEIGHT - 4}>
                {formatTime(chart.minT)}
              </text>
              <text x={WIDTH} y={HEIGHT - 4} textAnchor="end">
                {formatTime(chart.maxT)}
              </text>
            </g>
            <g transform={`translate(${PAD_LEFT},0)`}>
              <rect width={WIDTH - PAD_LEFT} height={HEIGHT - PAD_BOTTOM} fill="none" stroke={theme.palette.divider} />
              <path d={chart.path} fill="none" stroke={theme.palette.primary.main} strokeWidth={1.5} />
            </g>
          </svg>
        )}
      </CardContent>
    </Card>
  );
}
