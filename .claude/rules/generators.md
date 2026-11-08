---
paths:
  - "src/generators/**"
---

# Generators

**Purpose:** traps of single generators.

**Audience:** AGENTS editing `src/generators/**` (loaded when such a file is read).

**Contains:** one paragraph per generator; imperative.

**Not here:** layout and the stable accessory `name` (root `CLAUDE.md`), history.

**Dreame** (`src/generators/dreame.ts`): one Switch per shortcut, vacuums only (needs `<did>.remote.return-to-dock`;
mowers have `remote.start-charge` instead and are skipped as invalid). `On` uses yahka `ioBroker.MultiState` (array
parameter, not JSON text) with scripts: On writes `[true, undefined]` (press `.start`), Off writes
`[undefined, true]` (press `return-to-dock`). The dreame adapter runs a command for ANY written value, so never write
`false`; yahka skips `undefined` elements. `.running` (read-only) is the read state. `availableState` is
`<did>.info.online`.
