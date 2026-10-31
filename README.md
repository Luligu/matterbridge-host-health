# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge Host Health

[![npm version](https://img.shields.io/npm/v/matterbridge-host-health.svg)](https://www.npmjs.com/package/matterbridge-host-health)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-host-health.svg)](https://www.npmjs.com/package/matterbridge-host-health)
[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge/latest?label=docker%20version)](https://hub.docker.com/r/luligu/matterbridge)
[![Docker Pulls](https://img.shields.io/docker/pulls/luligu/matterbridge?label=docker%20pulls)](https://hub.docker.com/r/luligu/matterbridge)
![Node.js CI](https://github.com/Luligu/matterbridge-host-health/actions/workflows/build.yml/badge.svg)
![CodeQL](https://github.com/Luligu/matterbridge-host-health/actions/workflows/codeql.yml/badge.svg)
[![codecov](https://codecov.io/gh/Luligu/matterbridge-host-health/branch/main/graph/badge.svg)](https://codecov.io/gh/Luligu/matterbridge-host-health)
[![tested with Vitest](https://img.shields.io/badge/tested_with-Vitest-6E9F18.svg?logo=vitest&logoColor=white)](https://vitest.dev)
[![styled with Oxc](https://img.shields.io/badge/styled_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/formatter.html)
[![linted with Oxc](https://img.shields.io/badge/linted_with-Oxc-9BE4E0.svg?logo=oxc&logoColor=white)](https://oxc.rs/docs/guide/usage/linter.html)
[![TypeScript Native](https://img.shields.io/badge/TypeScript_Native-3178C6?logo=typescript&logoColor=white)](https://github.com/microsoft/typescript-go)
[![ESM](https://img.shields.io/badge/ESM-Node.js-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![matterbridge.io](https://img.shields.io/badge/matterbridge.io-online-brightgreen)](https://matterbridge.io)

[![powered by](https://img.shields.io/badge/powered%20by-matterbridge-blue)](https://www.npmjs.com/package/matterbridge)
[![powered by](https://img.shields.io/badge/powered%20by-matter--history-blue)](https://www.npmjs.com/package/matter-history)
[![powered by](https://img.shields.io/badge/powered%20by-node--ansi--logger-blue)](https://www.npmjs.com/package/node-ansi-logger)
[![powered by](https://img.shields.io/badge/powered%20by-node--persist--manager-blue)](https://www.npmjs.com/package/node-persist-manager)

---

A Linux-only Matterbridge plugin that exposes host CPU temperatures as Matter temperature sensor devices.

## Features

- One temperature sensor per detected CPU channel (package, core, die or CCD).
- Linux discovery through CPU `hwmon` drivers and CPU-labelled channels, with CPU thermal zones as a fallback when no hwmon CPU channels exist.
- Periodic updates, stable device identities and the standard Matterbridge device selection lists.
- Missing, unreadable or invalid temperatures are reported as unavailable, never as zero.
- Unsupported operating systems show a warning snackbar and create no devices.

Requires Matterbridge 3.11.0 or later.

## Installation

Add `matterbridge-host-health` in the Matterbridge frontend once the package is published. For local development, build this directory and use `matterbridge --add /absolute/path/to/matterbridge-host-health` with your existing Matterbridge installation.

## Configuration

| Setting                | Default | Description                                                                   |
| ---------------------- | ------- | ----------------------------------------------------------------------------- |
| `pollInterval`         | `30`    | Reading interval in seconds, from 5 to 3600. Invalid values fall back to 30.  |
| `sysfsPath`            | `/sys`  | Linux sysfs root, including a Docker bind mount if used.                      |
| `whiteList`            | `[]`    | Expose only selected device names or serial numbers. Empty exposes all.       |
| `blackList`            | `[]`    | Exclude selected devices.                                                     |
| `nodeLabels`           | `{}`    | Per-device objects with a `name` string for the name shown by the controller. |
| `debug`                | `false` | Enable debug logging.                                                         |
| `unregisterOnShutdown` | `false` | Unregister devices on shutdown for debugging.                                 |

The `nodeLabels` name changes the name the controller sees, like renaming the device in the controller UI. After registration, only the newly registered device is updated. During configuration and whenever the plugin configuration is saved, all entries are processed. Node label changes apply immediately without a restart. Each key is matched to a device name and its `name` is applied to the device's `nodeLabel` attribute and logged at INFO level. A missing device logs a warning and skips that entry. Each `name` must be a string of 1–32 characters; an invalid name logs a warning and skips that entry.

Devices are created only during startup. Discovery runs only at startup. Polling and configuration read the saved sensor sources and update existing devices; restart the plugin to discover new sensors. Keep the hostname and mount path stable to preserve sensor identities across restarts. Restart the plugin after changing device selection.

## Linux

The plugin reads `temp*_input` in millidegrees Celsius. Recognized CPU drivers include Intel `coretemp`, AMD `k10temp` / `k8temp` / `zenpower`, Raspberry Pi CPU thermal drivers and PECI CPU sensors. CPU-labelled channels from other drivers are also included. Other hardware such as GPU, NVMe and motherboard system temperatures is excluded.

If no hwmon CPU channels exist, CPU/SoC thermal zones are used. This avoids the usual duplicate exposure of a CPU reading through both kernel interfaces. Availability depends on the host kernel drivers and permissions. If nothing is found, the plugin logs a warning and keeps checking existing devices; restart the plugin after making sensors available. It never creates simulated devices.

AMD `Tctl` is a cooling-control temperature and may differ from the physical die temperature. Channels retain their kernel labels. See the kernel documentation for [coretemp](https://docs.kernel.org/hwmon/coretemp.html), [k10temp](https://docs.kernel.org/hwmon/k10temp.html) and the [hwmon sysfs interface](https://docs.kernel.org/hwmon/sysfs-interface.html).

## Docker: map host temperature sensors

Run Docker Engine on the Linux host whose temperatures you want to monitor. Mount its sysfs read-only so symlinks in `/sys/class/hwmon` and `/sys/class/thermal` can resolve into `/sys/devices`.

Add this volume to your existing Matterbridge Compose service:

```yaml
services:
  matterbridge:
    volumes:
      - /sys:/host-sys:ro
```

Then set the plugin configuration:

```json
{
  "sysfsPath": "/host-sys",
  "pollInterval": 30
}
```

For `docker run`, add `--mount type=bind,source=/sys,target=/host-sys,readonly` and use the same plugin configuration. Recreate the container after changing mounts.

For a Raspberry Pi CPU temperature, `/sys/class/thermal/thermal_zone0/temp` is a common source. The whole-sysfs mount above maps it to `/host-sys/class/thermal/thermal_zone0/temp`, with its adjacent `type` file and symlink targets. Mapping only a single `temp` file is insufficient for discovery. The container user must have read permission; privileged mode is not required.

Docker Desktop runs Linux in a VM. Its sysfs describes that VM rather than the physical host. Use Docker Engine on the Linux host to read its CPU temperatures.

## Development

This project is based on `matterbridge-plugin-template`. Package metadata, config/schema names, platform implementation, tests, README and changelog have been customized for Host Health. The inherited CI, development containers and tooling remain available.

Use the package scripts:

```sh
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run test
```

## Development guide

Refer to the Matterbridge [Development guide](https://matterbridge.io/README-DEV.html) for other guidelines.

## Repository toolchain

See [TOOLCHAIN.md](./TOOLCHAIN.md) for compilers, linting, formatting, testing, and editor support.

## Shared agent instructions

See [SHARED-AGENTS.md](./SHARED-AGENTS.md) for shared guidance, rules, skills, and configuration for coding agents.

See [.agents/README.md](./.agents/README.md) for the shared instructions layout and versioning.

## Shared dev container support

See [.devcontainer/README.md](./.devcontainer/README.md) for the shared development container setup and usage.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for contribution guidelines.

## Style guide

See [STYLEGUIDE.md](./STYLEGUIDE.md) for code style, naming, documentation, and testing conventions.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for release history and notable changes.

## Issues and feature requests

Report bugs and suggest improvements on [GitHub Issues](https://github.com/Luligu/matterbridge-host-health/issues).

## License

Licensed under the [Apache License 2.0](./LICENSE).

## Support the project

If you find this project useful, please consider giving it a star on GitHub and sponsoring it. Your support helps maintain and improve the project.

[!["Buy Me A Coffee"](https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png)](https://www.buymeacoffee.com/luligugithub)
