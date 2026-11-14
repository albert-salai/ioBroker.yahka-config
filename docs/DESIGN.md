# Design

**Purpose:** how the adapter meets its requirements, and why.

**Audience:** the MAINTAINER of this adapter and every AGENT that changes or traces its code.

**Contains:** the components, the rationale and the failure behaviour, per group of requirements; written to be read from
top to bottom.

**Not here:** the requirements ([`REQUIREMENTS.md`](REQUIREMENTS.md)), where a change goes and how the code runs (the
code and its comments).

## Contents

- **[Components](#components)**
- **[Update run](#update-run)**
- **[Merge](#merge)**
- **[Generators](#generators)**
- **[Settings](#settings)**

## Components

The adapter ([`src/main.ts`](../src/main.ts)) only orchestrates: it reads the settings, loops over the Yahka instances,
runs the generators of the ticked sources, merges the result into the Yahka configuration and saves it. Each source
adapter has one generator in [`src/generators/`](../src/generators/) with the same contract: it returns the devices, the
names it cannot generate and the states that need history. The merge rules sit in [`src/lib/merge.ts`](../src/lib/merge.ts),
shared helpers for characteristics in [`src/lib/helpers.ts`](../src/lib/helpers.ts).

## Update run

**Satisfies:** REQ-RUN, REQ-FAIL-KEEP, REQ-SAVE, REQ-HISTORY

The adapter is a scheduled job: it runs once per start and ends itself, so the adapter's schedule sets the period and no
process stays resident. A Yahka instance is the unit of work, and a failure in one does not stop the others.

Yahka derives the identity of an accessory from its name, so a source that fails or answers empty must not turn into
a diff: it would mark every device of that source obsolete, and the Home app would lose the rooms and automations of
them. The adapter therefore leaves the Yahka configuration alone on any source failure, an empty source whose devices
Yahka lists, or a duplicate name. The new configuration is compared with the old one and written only on a difference;
each difference is logged. History is enabled before the comparison, because the history setting lives on the source's
state objects, not in Yahka.

A debug switch writes the result to files instead of changing any object, to inspect a run without risk.

## Merge

**Satisfies:** REQ-MERGE-ADD, REQ-MERGE-KEEP, REQ-MERGE-OBSOLETE, REQ-MERGE-INVALID, REQ-MERGE-STABLE

The Yahka configuration is both the output and a store of the user's choices (which device is hidden), so the merge
starts from the old list and takes the generated services over. Devices Yahka lists keep their order; vanished and
invalid ones are kept but switched off and grouped, never deleted, because deleting would drop their Home app identity
should the source return. Newly created devices are appended. Each generator takes the name from the source's own
identifier (a Zigbee device from its IEEE address), because a display name can change.

## Generators

**Satisfies:** REQ-SRC-ROLE, REQ-SRC-SHELLY, REQ-SRC-TR064, REQ-SRC-FRITZ, REQ-SRC-DANFOSS, REQ-SRC-ZIGBEE,
REQ-SRC-ZIGBEE-SENSOR, REQ-SRC-DREAME

A generator reads only the object tree of its source, except the Zigbee one, which also needs the device description
that Zigbee2MQTT publishes retained on its MQTT broker; the broker is the one the Zigbee2MQTT instance is configured for, the local broker when it names none. Link quality and availability get history for every Zigbee device the source lists. A mapping
table per product or role keeps the accessories data, not code, so a new product is one more entry.

Characteristics read acknowledged values only, so a command that is still in flight does not show as the device's state.
The Dreame switch needs different states for reading and writing and the robot runs a command for any written value, so
the switch writes only the state that matches the new position. Sources that report availability give it to the Home
app as the device's reachability.

## Settings

**Satisfies:** REQ-MAPPING

The settings page ([`admin/index_m.js`](../admin/index_m.js)) builds its table from the instances that exist and lists
the supported source adapters in one place; a new generator must be added there too, or its source cannot be ticked.
Stale instances are dropped at load so the stored mapping matches the system.
