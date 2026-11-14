import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { Alert, Box, CircularProgress, Container, CssBaseline, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { useCallback, useEffect, useMemo, useState } from 'react';

import matterbridgeLogo from './assets/matterbridge.svg';
import type { DeviceInfo, HistoryEntry } from './chart.ts';
import { TemperatureChart } from './TemperatureChart.tsx';
import { createAppTheme, type ThemeMode } from './theme.ts';

const THEME_MODE_KEY = 'themeMode';
const REFRESH_INTERVAL = 60 * 1000;

/**
 * Reads the initial theme mode from localStorage, falling back to the OS preference.
 *
 * @returns {ThemeMode} The initial theme mode.
 */
function getInitialMode(): ThemeMode {
  const stored = localStorage.getItem(THEME_MODE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * The common page header: plugin logo, title and the light/dark theme toggle.
 *
 * @param {object} props - The component props.
 * @param {ThemeMode} props.mode - The active theme mode, for the toggle icon and tooltip.
 * @param {() => void} props.onToggleMode - Handler that toggles between light and dark mode.
 * @returns {JSX.Element} The rendered header.
 */
function Header({ mode, onToggleMode }: { mode: ThemeMode; onToggleMode: () => void }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 4 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <img src={matterbridgeLogo} alt="Matterbridge" width={64} height={64} />
        <Typography variant="h4" component="h1">
          Matterbridge host CPU temperature monitoring
        </Typography>
      </Box>
      <Tooltip title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
        <IconButton onClick={onToggleMode} color="inherit" aria-label="toggle light/dark theme">
          {mode === 'dark' ? <Brightness7Icon /> : <Brightness4Icon />}
        </IconButton>
      </Tooltip>
    </Box>
  );
}

/**
 * Fetches a JSON value from the plugin api namespace.
 * The url is relative to BASE_URL so the request keeps the Home Assistant Ingress prefix.
 *
 * @param {string} path - The api path, without a leading slash.
 * @param {AbortSignal} signal - The abort signal.
 * @returns {Promise<T>} The parsed response.
 */
async function fetchApi<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data: unknown = await response.json();
  // The plugin's own api defines the response shape.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return data as T;
}

/**
 * Lists the registered devices with a temperature graph each, refreshed every minute.
 * When opened from a device configUrl (`?device=<serial>`), shows only that device.
 *
 * @returns {JSX.Element} The rendered device list.
 */
function Devices() {
  const [devices, setDevices] = useState<{ device: DeviceInfo; entries: HistoryEntry[] }[]>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        const serial = new URLSearchParams(window.location.search).get('device');
        const list = serial
          ? [await fetchApi<DeviceInfo>(`device?serial=${encodeURIComponent(serial)}`, controller.signal)]
          : await fetchApi<DeviceInfo[]>('devices', controller.signal);
        const histories = await Promise.all(list.map(async (device) => fetchApi<HistoryEntry[]>(`device-history?serial=${encodeURIComponent(device.serial)}`, controller.signal)));
        setDevices(list.map((device, index) => ({ device, entries: histories[index] })));
        setError(undefined);
      } catch (err) {
        if (!controller.signal.aborted) setError(String(err));
      }
    };
    void load();
    const timer = setInterval(() => {
      void load();
    }, REFRESH_INTERVAL);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  if (error) return <Alert severity="error">Unable to load devices: {error}</Alert>;
  if (!devices) return <CircularProgress />;
  if (!devices.length) return <Typography color="text.secondary">No devices registered.</Typography>;
  return (
    <Stack spacing={2}>
      {devices.map(({ device, entries }) => (
        <TemperatureChart key={device.serial} device={device} entries={entries} />
      ))}
    </Stack>
  );
}

/**
 * Single-page app for the matterbridge plugin template frontend.
 *
 * @returns {JSX.Element} The rendered page.
 */
export default function App() {
  const [mode, setMode] = useState<ThemeMode>(getInitialMode);
  const theme = useMemo(() => createAppTheme(mode), [mode]);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      localStorage.setItem(THEME_MODE_KEY, next);
      return next;
    });
  }, []);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="lg" sx={{ pb: 4 }}>
        <Header mode={mode} onToggleMode={toggleMode} />
        <Devices />
      </Container>
    </ThemeProvider>
  );
}
