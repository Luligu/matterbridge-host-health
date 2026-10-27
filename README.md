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

| Setting                | Default | Description                                                                  |
| ---------------------- | ------- | ---------------------------------------------------------------------------- |
| `pollInterval`         | `30`    | Reading interval in seconds, from 5 to 3600. Invalid values fall back to 30. |
| `sysfsPath`            | `/sys`  | Linux sysfs root, including a Docker bind mount if used.                     |
| `whiteList`            | `[]`    | Expose only selected device names or serial numbers. Empty exposes all.      |
| `blackList`            | `[]`    | Exclude selected devices.                                                    |
| `debug`                | `false` | Enable debug logging.                                                        |
| `unregisterOnShutdown` | `false` | Unregister devices on shutdown for debugging.                                |

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

## Style guide

See also the [Style Guide](./STYLEGUIDE.md) for JSDoc, naming, and logging conventions used in this repository.

## Repository toolchain

> **Note:** This repository uses a new toolchain. It replaces the traditional TypeScript / ESLint / Prettier / Jest stack with a faster and lighter setup.

- **No `typescript 6.x` package** — replaced by [TypeScript Native 7.x](https://github.com/microsoft/typescript-go).
- **No ESLint, no Prettier** — replaced by the [oxc](https://oxc.rs) stack: [oxlint](https://oxc.rs/docs/guide/usage/linter.html) for linting and [oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) for formatting.
- **No Jest** — replaced by [Vitest](https://vitest.dev), which is much faster and natively supports ESM without extra configuration.
- **Far fewer development dependencies** — the number of installed packages drops from **~600** to **~75**. A clean install is much faster.
- **Much faster linting and formatting** — oxlint and oxfmt run in a fraction of the time required by the ESLint / Prettier pipeline.
- **Much faster builds** — tsgo compiles the project in a fraction of the time required by the standard `tsc` build.
- **Editor support** — use the VS Code extensions for tsgo and oxc to get the same experience in the editor.

## Shared agent instructions

All coding agents read the same guidance. [AGENTS.md](./AGENTS.md) and [.agents/](./.agents/) are the **single source of truth**; everything under `.github/`, `.claude/`, `.codex/` and `.antigravity/` are pointers and mirrors. Edit `.agents/` (or `AGENTS.md`), never the copies. See [.agents/README.md](./.agents/README.md) for the full layout.

| File                                            | Notes                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                     | Main project instructions — shared by every agent                                                            |
| `.agents/README.md`                             | Layout and versioning of the shared instructions                                                             |
| `.agents/rules/testing.instructions.md`         | Testing standards for unit tests                                                                             |
| `.agents/rules/matterbridge.instructions.md`    | Creating endpoints and using the single-class devices                                                        |
| `.agents/rules/plugin-frontend.instructions.md` | Serving a plugin's own frontend SPA and REST API                                                             |
| `.agents/rules/chip-tests.instructions.md`      | The CHIP conformance test harness                                                                            |
| `.agents/skills/verify-agent-context/SKILL.md`  | Verify the agent loaded this context — `$verify-agent-context` (Codex), `/verify-agent-context` (all others) |

Content lives only in `.agents/`. The per-agent folders exist because each tool discovers rules and skills from its own hardcoded location, so they hold stubs that point back here — except where the tool reads `.agents/` natively.

| Tool                               | Instructions                                    | Rules                                                 | Skills                                              |
| ---------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- |
| Codex                              | `AGENTS.md` — read natively                     | `.agents/rules/` — linked from `AGENTS.md`, on demand | `.agents/skills/` — native, `$verify-agent-context` |
| Copilot (VS Code and coding agent) | `.github/copilot-instructions.md` → `AGENTS.md` | stubs in `.github/instructions/` — `applyTo` globs    | stub in `.github/skills/` — `/verify-agent-context` |
| Claude Code                        | `CLAUDE.md` imports `AGENTS.md`                 | stubs in `.claude/rules/` — `paths` globs             | stub in `.claude/skills/` — `/verify-agent-context` |
| Gemini / Antigravity               | `GEMINI.md` imports `AGENTS.md`                 | `.agents/rules/` — on demand                          | `.agents/skills/` — native, `/verify-agent-context` |

### Copilot instructions

| File                                                                   | Notes                                                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `.github/copilot-instructions.md`                                      | Pointer to AGENTS.md — always loaded                                               |
| `.github/instructions/chip-tests/chip-tests.instructions.md`           | CHIP conformance test harness — scoped to CHIP test files                          |
| `.github/instructions/matterbridge/matterbridge.instructions.md`       | Matterbridge endpoint guide — dedicated Copilot instruction file                   |
| `.github/instructions/plugin-frontend/plugin-frontend.instructions.md` | Plugin frontend SPA and custom REST API guide — scoped to frontend and plugin code |
| `.github/instructions/testing/testing.instructions.md`                 | Testing standards — scoped to `**/*.test.ts`                                       |
| `.github/skills/verify-agent-context/SKILL.md`                         | Skill invocable as `/verify-agent-context`                                         |

### Claude instructions

| File                                                            | Notes                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `CLAUDE.md`                                                     | Pointer to AGENTS.md — always loaded                                               |
| `.claude/settings.json`                                         | Claude permissions: allow, ask and deny rules                                      |
| `.claude/rules/chip-tests/chip-tests.instructions.md`           | CHIP conformance test harness — scoped to CHIP test files                          |
| `.claude/rules/matterbridge/matterbridge.instructions.md`       | Matterbridge endpoint guide — loaded for all contexts                              |
| `.claude/rules/plugin-frontend/plugin-frontend.instructions.md` | Plugin frontend SPA and custom REST API guide — scoped to frontend and plugin code |
| `.claude/rules/testing/testing.instructions.md`                 | Testing standards — scoped to `**/*.test.ts`                                       |
| `.claude/skills/verify-agent-context/SKILL.md`                  | Skill invocable as `/verify-agent-context`                                         |

### Codex instructions

| File                         | Notes                                                             |
| ---------------------------- | ----------------------------------------------------------------- |
| `AGENTS.md`                  | Main project instructions — read directly, no pointer file needed |
| `.codex/config.toml`         | Codex project permissions, approvals, and profile                 |
| `.codex/rules/default.rules` | Codex command allow, prompt, and deny rules                       |

Codex reads the shared rules and skills from `.agents/` directly; the skill is invoked as `$verify-agent-context`.

### Gemini / Antigravity instructions

| File                         | Notes                                                 |
| ---------------------------- | ----------------------------------------------------- |
| `GEMINI.md`                  | Pointer to AGENTS.md — always loaded                  |
| `.antigravity/settings.json` | Sandboxing and permissions: allow, ask and deny rules |

The shared rules under `.agents/rules/` apply on demand for the relevant tasks, and `.agents/skills/` is discovered automatically as `/verify-agent-context`.

## Development guide

Refer to the Matterbridge [Development guide](https://matterbridge.io/README-DEV.html) for other guidelines.

---
