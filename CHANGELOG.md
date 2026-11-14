# <img src="https://matterbridge.io/assets/matterbridge.svg" alt="Matterbridge Logo" width="64px" height="64px">&nbsp;&nbsp;&nbsp;Matterbridge Host Health changelog

[![npm version](https://img.shields.io/npm/v/matterbridge-host-health.svg)](https://www.npmjs.com/package/matterbridge-host-health)
[![npm downloads](https://img.shields.io/npm/dt/matterbridge-host-health.svg)](https://www.npmjs.com/package/matterbridge-host-health)
[![Docker Version](https://img.shields.io/docker/v/luligu/matterbridge/latest?label=docker%20version)](https://hub.docker.com/r/luligu/matterbridge)
[![Docker Pulls](https://img.shields.io/endpoint?url=https://gist.githubusercontent.com/Luligu/b21088ab9c9f2b119b42c33f0fef218d/raw/docker.json)](https://hub.docker.com/r/luligu/matterbridge)
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

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

If you like this project and find it useful, please consider giving it a star on [GitHub](https://github.com/Luligu/matterbridge-host-health) and sponsoring it.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="120"></a>

---

## [1.0.2] - Dev branch

### Added

- [frontend]: Add a temperature history graph for each registered device, refreshed every minute.
- [api]: Add the `devices`, `device?serial=<serial>` and `device-history?serial=<serial>` plugin API endpoints served by `onFetch`.
- [device]: Set each device `configUrl` to open the frontend graph of that single device.
- [history]: Add a circular temperature history per device serial number, loaded from the platform context on start and saved every 60 minutes and on shutdown.
- [platform]: Implement `onChangeLoggerLevel` to update the platform and registered device logger levels.
- [config]: Add `temperatureAlert` threshold setting (default `70` °C) and expose a child `contactSensor` (`BooleanState`) endpoint on each device that opens when the temperature exceeds `temperatureAlert`.
- [macos]: Add macOS (Apple Silicon) CPU/SoC temperature discovery and sampling via IOKit HID thermal sensors using optional [koffi](https://koffi.dev) FFI without `sudo`.
- [package]: Add optional [koffi](https://koffi.dev) v.3.3.8 dependency.

### Changed

- [config]: Change the default `pollInterval` from 30 to 60 seconds.
- [package]: Bump `node-ansi-logger` to v.3.3.2.
- [package]: Bump `node-persist-manager` to v.2.1.2.
- [package]: Bump `@vitest/coverage-v8` to v.5.1.0.
- [package]: Bump `oxfmt` to v.0.78.0.
- [package]: Bump `oxlint` to v.1.93.0.
- [package]: Bump `oxlint-tsgolint` to v.7.0.2007.
- [package]: Bump `vitest` to v.5.1.0.
- [agents]: Update `.agents/README.md` to v.1.0.6.
- [agents]: Update `.agents/rules/chip-tests.instructions.md`, `.claude/rules/chip-tests/chip-tests.instructions.md` and `.github/instructions/chip-tests/chip-tests.instructions.md` to v.1.0.1.
- [agents]: Update `.agents/rules/matterbridge.instructions.md`, `.claude/rules/matterbridge/matterbridge.instructions.md` and `.github/instructions/matterbridge/matterbridge.instructions.md` to v.1.0.4.
- [agents]: Update `.agents/rules/plugin-frontend.instructions.md`, `.claude/rules/plugin-frontend/plugin-frontend.instructions.md` and `.github/instructions/plugin-frontend/plugin-frontend.instructions.md` to v.1.0.3.
- [agents]: Update `.agents/rules/testing.instructions.md`, `.claude/rules/testing/testing.instructions.md` and `.github/instructions/testing/testing.instructions.md` to v.1.0.8.
- [agents]: Update `.agents/skills/verify-agent-context/SKILL.md`, `.claude/skills/verify-agent-context/SKILL.md` and `.github/skills/verify-agent-context/SKILL.md` to v.1.0.6.
- [agents]: Update `.antigravity/settings.json` to v.1.0.6.
- [agents]: Update `.claude/settings.json` to v.1.0.12.
- [codex]: Update `.codex/config.toml` to v.1.0.8.
- [codex]: Update `.codex/rules/default.rules` to v.1.0.8.
- [workflows]: Update `.github/workflows/build.yml` to v.2.0.8.
- [workflows]: Update `.github/workflows/codecov.yml` to v.2.0.8.
- [workflows]: Update `.github/workflows/codeql.yml` to v.2.0.0.
- [workflows]: Update `.github/workflows/publish.yml` to v.2.0.7.
- [config]: Update `.gitignore` to v.1.0.5.
- [config]: Update `.oxfmtrc.json` to v.1.2.0.
- [config]: Update `.oxlintrc.json` to v.1.2.0.
- [vscode]: Update `.vscode/extensions.json` to v.1.0.6.
- [vscode]: Update `.vscode/settings.json` to v.1.0.21.
- [agents]: Update `AGENTS.md` to v.1.0.12.
- [config]: Update `SHARED-AGENTS.md` to v.1.0.0.
- [styleguide]: Update `STYLEGUIDE.md` to v.1.1.1.
- [config]: Update `vitest.config.ts` to v.2.0.9.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.1] - 2026-10-31

### Added

- [config]: Apply node label updates immediately through onConfigChanged.
- [config]: Add the nodeLabels object with a per-device name setting to the schema, default config and configuration type.
- [config]: Apply valid 1–32 character node labels for each newly registered device and all devices during onConfigure, log changes at INFO level and warn and skip invalid names or missing devices.

### Changed

- [package]: Bump `@types/node` to v.26.6.6 and refresh transitive dependencies.
- [agents]: Update `AGENTS.md` to v.1.0.8.
- [tooling]: Refresh shared templates and repository documentation with mb-run.
- [scripts]: Update downloads.mjs to v.2.2.0 to handle missing npm download data for new packages.

<a href="https://www.buymeacoffee.com/luligugithub"><img src="https://matterbridge.io/assets/bmc-button.svg" alt="Buy me a coffee" width="80"></a>

## [1.0.0] - 2026-10-27

Initial release.
