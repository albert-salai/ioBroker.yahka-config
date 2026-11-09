# ioBroker.yahka-config

**Purpose:** project facts, traps and the index of the lazy files for this adapter.

**Audience:** every AGENT in this repo.

**Contains:** project facts, code layout, traps, setup extras, the lazy-file table; short imperative rules.

**Not here:** adapter development rules (`/opt/iobroker/my_modules/CLAUDE.md`), adapter setup rules
(`~/.claude/rules/iobroker-adapter.md`), rules for one generator (lazy files).

ioBroker adapter for Yahka (HomeKit) configuration.

**Path:** `/opt/iobroker/my_modules/ioBroker.yahka-config`; Linux (Raspberry Pi).

## Code layout

- `src/main.ts`: adapter class only (orchestration); `src/lib/`: `types`, `helpers`, `merge`; `admin/index_m.js`
  (`srcAdapters` = list of source adapters shown as checkboxes, must include every generator); `src/generators/*` (one
  per source adapter, shared `Generator` signature returning `{devices, invalid, historyIds}`).
- Accessory `name` builds the HomeKit UUID and must stay stable: always `<srcInstId>.<stable id>` (zigbee: ieee address,
  not friendly name).
- `npm test` runs mocha (tsx) on `src/**/*.test.ts` with fixtures in `src/fixtures.json`.
- Debug: `YAHKA_CONFIG_DRYRUN=<dir>` writes new devices to `<dir>/<dstId>.json` and saves no ioBroker object (also skips
  history writes).
- Integration test allows exit code 11 (the adapter stops itself until its next scheduled run).

## Setup extras (B-EXTRAS)

Setup rules: `~/.claude/rules/iobroker-adapter.md`. Beyond the baseline: `release-script` (`npm run release`);
`admin/index_m.js` is excluded from lint (untyped legacy admin UI); `.gitignore` entry for the `.claude/`
exceptions.

## Lazily loaded knowledge

| File | Loads when | Covers |
|---|---|---|
| `.claude/rules/generators.md` | `src/generators/**` | per-generator traps (Dreame) |
