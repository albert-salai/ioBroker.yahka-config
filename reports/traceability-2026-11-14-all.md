# Traceability: yahka-config, repo, all

Draft by an unattended run; every requirement is `INFERRED: ` and waits for the MAINTAINER. Tests not requested.

| Req ID | Satisfied by | Implemented in | Status |
|---|---|---|---|
| REQ-RUN | [DESIGN](../docs/DESIGN.md) Update run | `src/main.ts` onReady, terminate | ✅ |
| REQ-MERGE-ADD | DESIGN Merge | `src/lib/merge.ts` mergeDevices, applyDefaults | ✅ |
| REQ-MERGE-KEEP | DESIGN Merge | `src/lib/merge.ts` mergeDevices | ✅ |
| REQ-MERGE-OBSOLETE | DESIGN Merge | `src/lib/merge.ts` mergeDevices | ✅ |
| REQ-MERGE-INVALID | DESIGN Merge | `src/lib/merge.ts`; invalid list of `zigbee2mqtt.ts`, `dreame.ts` | ✅ |
| REQ-MERGE-STABLE | DESIGN Merge | every generator's `name` | ✅ |
| REQ-SAVE | DESIGN Update run | `src/main.ts` updateYahkaDevices (deepDiff) | ✅ |
| REQ-FAIL-KEEP | DESIGN Update run | `src/main.ts` createDevices; `merge.ts` assertSourceNotEmpty, duplicateNames | ✅ |
| REQ-HISTORY | DESIGN Update run | `src/main.ts` enableHistory; `fritzdect.ts`, `zigbee2mqtt.ts` historyIds | ✅ |
| REQ-MAPPING | DESIGN Settings | `admin/index_m.js` load, save | ✅ |
| REQ-SRC-ROLE | DESIGN Generators | `src/generators/by-role.ts` | ✅ |
| REQ-SRC-SHELLY | DESIGN Generators | `src/generators/shelly.ts` | ✅ |
| REQ-SRC-TR064 | DESIGN Generators | `src/generators/tr064.ts` | ✅ |
| REQ-SRC-FRITZ | DESIGN Generators | `src/generators/fritzdect.ts` | ✅ |
| REQ-SRC-DANFOSS | DESIGN Generators | `src/generators/danfoss.ts` | ✅ |
| REQ-SRC-ZIGBEE, REQ-SRC-ZIGBEE-SENSOR | DESIGN Generators | `src/generators/zigbee2mqtt.ts` | ✅ |
| REQ-SRC-DREAME | DESIGN Generators | `src/generators/dreame.ts` | ✅ |

## Gaps

- ℹ️ The README of the repo was a stub; a short END USER description was added.
- ⚠️ Task: `sonoff` and `openweathermap` are offered in the settings page (`admin/index_m.js`) but have no generator;
  remove them or add generators. REQ-MAPPING notes it meanwhile. The README still carries the template's developer manual.
- ℹ️ Backward check: no test or code path lacks a requirement.
