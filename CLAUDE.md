# Project Configuration

## Project Overview
**ioBroker.yahka-config** — ioBroker adapter for Yahka (HomeKit) configuration.

## Development Notes
- **Location**: `/opt/iobroker/my_modules/ioBroker.yahka-config`
- **Platform**: Linux (Raspberry Pi)
- **Execute as user**: `iobroker` — all commands must use `sudo -u iobroker <command>`

## Claude Memory
- **Primary knowledge store**: This `CLAUDE.md` file — all project details and learned patterns should be recorded here, not in `~/.claude/projects/*/memory/`

## Code Layout & Testing
- `src/main.ts` — adapter class only (orchestration); `src/lib/` — `types`, `helpers`, `merge`, `generators/*` (one per source adapter, shared `Generator` signature returning `{devices, invalid, historyIds}`).
- Accessory `name` builds the HomeKit UUID and must stay stable: always `<srcInstId>.<stable id>` (zigbee: ieee address, not friendly name).
- `npm test` compiles `src` + `test` to `build-test/` and runs `node:test` with fixtures in `test/fixtures.json`.
- Debug: `YAHKA_CONFIG_DRYRUN=<dir>` writes new devices to `<dir>/<dstId>.json` and saves no ioBroker object (also skips history writes).

---
*Last updated: 2026-10-24*
