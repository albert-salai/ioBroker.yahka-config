import { strict as assert }		from 'node:assert';
import { describe, it }			from 'node:test';
import { createByRole }			from '../src/lib/generators/by-role';
import { createDanfoss }		from '../src/lib/generators/danfoss';
import { createFritzdect }		from '../src/lib/generators/fritzdect';
import { createShelly }			from '../src/lib/generators/shelly';
import { createTr064 }			from '../src/lib/generators/tr064';
import { createZigbee2mqtt, validateZigbeeDevice, zigbeeMqttSettings } from '../src/lib/generators/zigbee2mqtt';
import type { GeneratorAdapter, ZigbeeDevice } from '../src/lib/types';
import fixtures					from './fixtures.json';

// fake adapter serving the fixture objects
const objects = fixtures.objects as unknown as Record<string, ioBroker.Object>;
const states  = fixtures.states  as Record<string, string>;
const glob    = (pattern: string): RegExp => new RegExp('^' + pattern.replace(/[.#]/g, '\\$&').replace(/\*/g, '.*') + '$');
const adapter = {
	log: { debug() { /* */ }, info() { /* */ }, warn() { /* */ }, error() { /* */ } },
	getForeignObjectsAsync: (pattern: string, type?: string) => Promise.resolve(Object.fromEntries(
		Object.entries(objects).filter(([ id, obj ]) => glob(pattern).test(id) && (!type || obj.type === type)))),
	getForeignObjectAsync:	(id: string) => Promise.resolve(objects[id] ?? null),
	getForeignStateAsync:	(id: string) => Promise.resolve(id in states ? { val: states[id] } : null),
} as unknown as GeneratorAdapter;

const zigbeeDevs = fixtures.zigbeeDevs as unknown as ZigbeeDevice[];
const zigbee = (devs: ZigbeeDevice[] = zigbeeDevs) => createZigbee2mqtt({ adapter, srcInstId: 'zigbee2mqtt.0' }, () => Promise.resolve(devs));

describe('create_by_role (ROLE_MAP)', () => {
	it('maps every known role and skips unknown ones', async () => {
		const { devices } = await createByRole({ adapter, srcInstId: 'rpi-io.0' });
		const types = Object.fromEntries(devices.map(d => [ d.name, d.services[0]?.type ]));
		assert.deepEqual(types, {
			'rpi-io.0.pin.a': 'ContactSensor',	'rpi-io.0.pin.b': 'MotionSensor',	'rpi-io.0.pin.c': 'OccupancySensor',
			'rpi-io.0.pin.d': 'LeakSensor',		'rpi-io.0.pin.e': 'Switch',			'rpi-io.0.pin.f': 'Lightbulb',
			'rpi-io.0.pin.g': 'LockMechanism',	'rpi-io.0.pin.h': 'GarageDoorOpener','rpi-io.0.pin.i': 'Fan',
			'rpi-io.0.pin.k': 'Switch',
		});
	});
	it('puts Name first and inverts lock states', async () => {
		const { devices } = await createByRole({ adapter, srcInstId: 'rpi-io.0' });
		const lock = devices.find(d => d.name === 'rpi-io.0.pin.g')?.services[0];
		assert.deepEqual(lock?.characteristics.map(c => c.name), [ 'Name', 'LockTargetState', 'LockCurrentState' ]);
		assert.equal(lock?.characteristics[2]?.inOutParameters, 'rpi-io.0.pin.g_status');
		assert.equal(lock?.characteristics[1]?.conversionFunction, 'invert');
	});
});

describe('fritzdect', () => {
	it('creates known products, skips unknown ones and returns history ids', async () => {
		const { devices, historyIds } = await createFritzdect({ adapter, srcInstId: 'fritzdect.0' });
		assert.deepEqual(devices.map(d => d.services[0]?.type), [ 'TemperatureSensor', 'Switch', 'Thermostat' ]);
		assert.deepEqual(historyIds, [ 'fritzdect.0.0.DECT_1.celsius', 'fritzdect.0.0.DECT_2.state', 'fritzdect.0.0.DECT_3.tsoll', 'fritzdect.0.0.DECT_3.tist' ]);
		const thermo = devices[2]?.services[0]?.characteristics;
		assert.equal(thermo?.at(-1)?.name, 'Name');
		assert.equal(thermo?.find(c => c.name === 'TargetHeatingCoolingState')?.inOutParameters, 3);
	});
});

describe('shelly, tr064, danfoss', () => {
	it('shelly uses the channel id as accessory name and keeps the display name as model', async () => {
		const { devices } = await createShelly({ adapter, srcInstId: 'shelly.0' });
		assert.deepEqual(devices.map(d => d.name), [ 'shelly.0.SHDM-2#94B97E16BE61#1.lights', 'shelly.0.SHPLG-S#6A0761#1.Relay0' ]);
		assert.deepEqual(devices.map(d => d.model), [ 'Dimmer', 'Plug' ]);
	});
	it('tr064 only exposes boolean states that are not wlan', async () => {
		const { devices } = await createTr064({ adapter, srcInstId: 'tr-064.0' });
		assert.deepEqual(devices.map(d => d.name), [ 'tr-064.0.states.dnd', 'tr-064.0.states.wps' ]);
	});
	it('danfoss creates HousePause and thermostats with numeric constants', async () => {
		const { devices } = await createDanfoss({ adapter, srcInstId: 'danfossicon.0' });
		assert.equal(devices.length, 3);
		const chars = devices[1]?.services[0]?.characteristics;
		assert.equal(chars?.find(c => c.name === 'TemperatureDisplayUnits')?.inOutParameters, 0);
		assert.equal(chars?.find(c => c.name === 'TargetHeatingCoolingState')?.inOutParameters, 3);
	});
});

describe('zigbee2mqtt', () => {
	it('uses the ieee address in the accessory name, not the friendly name', async () => {
		const { devices } = await zigbee();
		assert.ok(devices.length > 0);
		for (const d of devices) {
			assert.match(d.name, /^zigbee2mqtt\.0\.0xa\d$/);
		}
		assert.equal(devices[0]?.model, 'Lamp');
	});
	it('creates lightbulb and sensor services (+ linked, battery) in expose order', async () => {
		const { devices } = await zigbee();
		const services = (name: string) => devices.find(d => d.name === name)?.services.map(s => s.type);
		assert.deepEqual(services('zigbee2mqtt.0.0xa1'), [ 'Lightbulb' ]);
		assert.deepEqual(services('zigbee2mqtt.0.0xa2'), [ 'ContactSensor', 'Battery' ]);
		assert.deepEqual(services('zigbee2mqtt.0.0xa3'), [ 'LeakSensor', 'Battery' ]);
		assert.deepEqual(services('zigbee2mqtt.0.0xa4'), [ 'OccupancySensor', 'LightSensor', 'Battery' ]);
		assert.deepEqual(services('zigbee2mqtt.0.0xa5'), [ 'TemperatureSensor', 'HumiditySensor', 'Battery' ]);
	});
	it('does not fail the source for typed exposes without name (switch, climate)', async () => {
		const { devices, invalid } = await zigbee();
		assert.ok(! devices.some(d => d.name.endsWith('0xa6') || d.name.endsWith('0xa9')), 'unsupported types produce no accessory');
		assert.ok(! invalid.includes('zigbee2mqtt.0.0xa6'));
		assert.ok(! invalid.includes('zigbee2mqtt.0.0xa9'));
	});
	it('reports a device with definition null as invalid', async () => {
		const { invalid } = await zigbee();
		assert.deepEqual(invalid, [ 'zigbee2mqtt.0.0xa7' ]);
	});
	it('enables history for link quality and availability', async () => {
		const { historyIds } = await zigbee();
		assert.ok(historyIds.includes('zigbee2mqtt.0.0xa1.link_quality'));
		assert.ok(historyIds.includes('zigbee2mqtt.0.0xa3.available'));
		assert.ok(! historyIds.includes('zigbee2mqtt.0.0xa3.link_quality'));
	});
	it('validateZigbeeDevice rejects bad fields', () => {
		const good = zigbeeDevs[0] as ZigbeeDevice;
		assert.doesNotThrow(() => validateZigbeeDevice(good));
		assert.throws(() => validateZigbeeDevice({ ...good, definition: null }));
		assert.throws(() => validateZigbeeDevice({ ...good, friendly_name: 1 as unknown as string }));
		assert.throws(() => validateZigbeeDevice({ ...good, software_build_id: 1 as unknown as string }));
		assert.throws(() => validateZigbeeDevice({ ...good, definition: { model: 'm', vendor: 'v', exposes: [ { type: 'binary' } ] } }));
	});
	it('zigbeeMqttSettings reads broker and topic, with defaults', () => {
		assert.deepEqual(zigbeeMqttSettings(undefined), { url: 'mqtt://127.0.0.1:1883', topic: 'zigbee2mqtt/bridge/devices' });
		assert.deepEqual(zigbeeMqttSettings({ connectionType: 'ws', baseTopic: 'z2m' }), { url: 'mqtt://127.0.0.1:1883', topic: 'z2m/bridge/devices' });
		assert.deepEqual(zigbeeMqttSettings({ connectionType: 'exmqtt', externalMqttServerIP: '10.0.0.2', externalMqttServerPort: 1884, externalMqttServerCredentials: true, externalMqttServerUsername: 'u', externalMqttServerPassword: 'p' }),
			{ url: 'mqtt://10.0.0.2:1884', username: 'u', password: 'p', topic: 'zigbee2mqtt/bridge/devices' });
		assert.deepEqual(zigbeeMqttSettings({ connectionType: 'intmqtt', mqttServerPort: 1885 }), { url: 'mqtt://127.0.0.1:1885', topic: 'zigbee2mqtt/bridge/devices' });
	});
});
