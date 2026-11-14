# Requirements

**Purpose:** the requirements of this adapter.

**Audience:** the MAINTAINER of this adapter and every AGENT that traces a change to its requirements.

**Contains:** the purpose of the adapter, the ID scheme, and the requirements, in sections per feature as the END USER
meets it; written to be read from top to bottom.

**Not here:** how the requirements are built ([`DESIGN.md`](DESIGN.md), source comments).

## Contents

- **[Purpose of the adapter](#purpose-of-the-adapter)**
- **[Scheme](#scheme)**
- **[Update run](#update-run)**: [Schedule](#schedule) · [Merge](#merge) · [Failure](#failure) · [History](#history)
- **[Settings](#settings)**
- **[Accessories by source adapter](#accessories-by-source-adapter)**: [Switches and outputs](#switches-and-outputs) ·
  [Thermostats](#thermostats) · [Zigbee devices](#zigbee-devices) · [Robot vacuums](#robot-vacuums)

## Purpose of the adapter

The adapter keeps the devices of the Yahka (HomeKit) bridge in step with the devices that other ioBroker adapters
provide. The user ticks, per Yahka instance, the source instances whose devices the Home app shows; the adapter then
adds new devices, switches vanished ones off and keeps the user's on/off choice per device, so the Home app follows the
house without hand-made configuration.

## Scheme

Statements follow the skill `specifying-requirements`. A requirement not yet confirmed by the MAINTAINER has the prefix
`INFERRED: ` before its ID.

## Update run

**Goal:** the user's Yahka bridge lists the current devices of the ticked sources without manual work.

### Schedule

INFERRED: **`REQ-RUN`: When the adapter starts, it regenerates the devices of every Yahka instance in the settings, then stops until its next scheduled start.**

The adapter's schedule sets the period. A Yahka instance that is not installed is
skipped with a warning.

### Merge

INFERRED: **`REQ-MERGE-ADD`: The adapter appends a device that a ticked source provides and Yahka does not yet list, with defaults for manufacturer, model, serial and firmware, and with all its characteristics on.**

INFERRED: **`REQ-MERGE-KEEP`: A device that Yahka already lists keeps its position and its on/off setting, and a device that is off moves to the group "~disabled~".**

The generated services replace the old ones, so a change at the source reaches the Home app, while the user's choice
to hide a device holds.

INFERRED: **`REQ-MERGE-OBSOLETE`: A device that Yahka lists but no ticked source provides any more is switched off and moved to the group "~obsolete~".**

INFERRED: **`REQ-MERGE-INVALID`: A device that its source reports but cannot be generated, for example a Zigbee device without definition, is switched off and moved to the group "~disabled~" when Yahka lists it, and is skipped without entry when Yahka does not.**

INFERRED: **`REQ-MERGE-STABLE`: A device keeps the name it was first created with, built from its source instance and a stable identifier of the device, so the Home app keeps its room, name and automations.**

A Zigbee device is identified by its IEEE address, never by the name the user gave it.

INFERRED: **`REQ-SAVE`: The adapter writes the Yahka configuration only when it changed, and logs each change.**

### Failure

INFERRED: **`REQ-FAIL-KEEP`: When a ticked source fails, or yields neither a device nor a skipped one although Yahka lists devices of it, or two generated devices share a name, the adapter leaves the devices of that Yahka instance unchanged and logs an error.**

A missing source would otherwise mark all its devices obsolete. The other Yahka instances still update.

### History

INFERRED: **`REQ-HISTORY`: For the FRITZ!DECT temperature, switch and setpoint states and the Zigbee link-quality and availability states of the devices it generated, the adapter enables history with the system's default history instance.**

This happens on every run in which the source succeeds, whether or not the Yahka configuration changed; without a default
history instance nothing is enabled.

## Settings

**Goal:** the user chooses which source instance feeds which Yahka instance.

INFERRED: **`REQ-MAPPING`: The settings page shows a table with a row per source instance and a column per Yahka instance, and a checkbox in each cell that includes or excludes the source for that Yahka instance.**

The settings list the instances of the source adapters and of Yahka that exist (the list also offers two adapters that have no generator, so ticking them has no effect); a new cell starts unticked,
and an instance that no longer exists drops out when the settings are saved.

## Accessories by source adapter

**Goal:** the Home app shows the controls and sensors of each source adapter in the way the Home app expects them.

Every generated device has a Home app name from the source's display name, and a device is unreachable in the Home app
while its source reports it offline, where the source offers such a state.

### Switches and outputs

INFERRED: **`REQ-SRC-ROLE`: For `rpi-io` and `switchboard-io`, each state whose role is a contact, motion, occupancy or leak sensor, a switch, a light switch, a fan switch, a door lock or a garage door becomes the matching Home app accessory; only these roles produce an accessory.**

A door lock or garage door shows the state of its status state as the current position and sends the target position to
the output.

INFERRED: **`REQ-SRC-SHELLY`: For each relay channel of a Shelly instance the adapter creates a switch, and for each light channel a light bulb with brightness.**

INFERRED: **`REQ-SRC-TR064`: For each boolean state of the TR-064 instance, for example the Wi-Fi switches of the router, the adapter creates a switch.**

INFERRED: **`REQ-SRC-FRITZ`: For each FRITZ!DECT device of a known product, the adapter creates a temperature sensor (Repeater 100), a switch (Smart Energy 200) or a thermostat (Smart Thermo 301); only these products produce an accessory, and any other product is logged as an error.**

The adapter also enables history for the states these devices show.

### Thermostats

INFERRED: **`REQ-SRC-DANFOSS`: For a Danfoss Icon instance the adapter creates a switch for the house pause and a thermostat per room with target temperature, room temperature and heating state; all thermostats are unreachable while the house is not connected.**

The thermostat shows automatic mode, in degrees Celsius, and heating while the valve is open and cooling otherwise.

### Zigbee devices

INFERRED: **`REQ-SRC-ZIGBEE`: For each Zigbee2MQTT device that exposes a light the adapter creates a light bulb with the brightness and colour temperature the device offers.**

INFERRED: **`REQ-SRC-ZIGBEE-SENSOR`: For each other Zigbee2MQTT device that exposes a contact, water-leak, occupancy or humidity reading the adapter creates the matching sensor, with a linked light-level or temperature sensor and a battery service where the device exposes them.**

A battery below the warning level shows as low battery in the Home app. Devices of other kinds get no accessory.

### Robot vacuums

INFERRED: **`REQ-SRC-DREAME`: For each shortcut of a Dreame robot vacuum the adapter creates a switch that starts the shortcut when turned on, sends the robot back to its dock when turned off and shows on while the shortcut runs; only shortcuts of vacuums become switches.**
