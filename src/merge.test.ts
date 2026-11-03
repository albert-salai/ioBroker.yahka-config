import { strict as assert }		from 'node:assert';
import { describe, it }			from 'node:test';
import { applyDefaults, assertSourceNotEmpty, duplicateNames, mergeDevices } from '../src/lib/merge';
import type { AccConfig }		from '../src/lib/types';

function dev(name: string, extra: Partial<AccConfig> = {}): AccConfig {
	return { name, category: '5', services: [], groupString: 'src.0', ...extra };
}

describe('mergeDevices', () => {
	it('keeps the order of oldDevs and appends added devices', () => {
		const oldDevs = [ dev('a', { enabled: true }), dev('b', { enabled: true }) ];
		const created = [ dev('c'), dev('b'), dev('a') ];
		const { newDevs, added, obsolete, disabled } = mergeDevices(oldDevs, created);
		assert.deepEqual(newDevs.map(d => d.name), [ 'a', 'b', 'c' ]);
		assert.deepEqual(added, [ 'c' ]);
		assert.deepEqual(obsolete, []);
		assert.deepEqual(disabled, []);
	});

	it('marks devices missing from created as obsolete and disabled', () => {
		const oldDevs = [ dev('a', { enabled: true }), dev('gone', { enabled: true }) ];
		const { newDevs, obsolete } = mergeDevices(oldDevs, [ dev('a') ]);
		assert.deepEqual(obsolete, [ 'gone' ]);
		assert.equal(newDevs[1]?.enabled, false);
		assert.equal(newDevs[1]?.groupString, '~obsolete~');
	});

	it('keeps a disabled device disabled and moves it to ~disabled~', () => {
		const { newDevs, disabled } = mergeDevices([ dev('a', { enabled: false }) ], [ dev('a') ]);
		assert.deepEqual(disabled, [ 'a' ]);
		assert.equal(newDevs[0]?.enabled, false);
		assert.equal(newDevs[0]?.groupString, '~disabled~');
	});

	it('treats an old device without enabled as disabled', () => {
		const { newDevs, disabled } = mergeDevices([ dev('a') ], [ dev('a') ]);
		assert.deepEqual(disabled, [ 'a' ]);
		assert.equal(newDevs[0]?.enabled, false);
	});

	it('disables an existing invalid device but keeps its old entry', () => {
		const old = dev('z', { enabled: true, model: 'old' });
		const { newDevs, disabled, obsolete } = mergeDevices([ old ], [], [ 'z' ]);
		assert.deepEqual(disabled, [ 'z' ]);
		assert.deepEqual(obsolete, []);
		assert.equal(newDevs[0]?.model, 'old');
		assert.equal(newDevs[0]?.enabled, false);
		assert.equal(newDevs[0]?.groupString, '~disabled~');
		assert.equal(old.enabled, true, 'old entry must not be modified');
	});

	it('ignores a new invalid device', () => {
		const { newDevs, added } = mergeDevices([], [ dev('a') ], [ 'z' ]);
		assert.deepEqual(newDevs.map(d => d.name), [ 'a' ]);
		assert.deepEqual(added, [ 'a' ]);
	});
});

describe('assertSourceNotEmpty', () => {
	const empty = { devices: [], invalid: [], historyIds: [] };

	it('throws if an empty source had devices in the old config', () => {
		assert.throws(() => { assertSourceNotEmpty('zigbee2mqtt.0', empty, [ dev('zigbee2mqtt.0.0xa1') ]); });
	});
	it('accepts an empty source without old devices of that source', () => {
		assert.doesNotThrow(() => { assertSourceNotEmpty('zigbee2mqtt.0', empty, [ dev('shelly.0.x') ]); });
	});
	it('accepts a source that only reports invalid devices', () => {
		assert.doesNotThrow(() => { assertSourceNotEmpty('zigbee2mqtt.0', { ...empty, invalid: [ 'zigbee2mqtt.0.0xa1' ] }, [ dev('zigbee2mqtt.0.0xa1') ]); });
	});
});

describe('duplicateNames', () => {
	it('lists names used more than once', () => {
		assert.deepEqual(duplicateNames([ dev('a'), dev('b'), dev('a'), dev('a') ]), [ 'a' ]);
		assert.deepEqual(duplicateNames([ dev('a'), dev('b') ]), []);
	});
});

describe('applyDefaults', () => {
	it('fills defaults without overriding set values and enables all characteristics', () => {
		const d = dev('a', { model: 'm' });
		d.services.push({ type: 'Switch', subType: '', name: 'n', characteristics: [ { name: 'On', inOutFunction: 'const', inOutParameters: true } ] });
		applyDefaults([ d ]);
		assert.equal(d.model, 'm');
		assert.equal(d.manufacturer, 'n/a');
		assert.equal(d.configType, 'customdevice');
		assert.equal(d.enabled, true);
		assert.equal(d.services[0]?.characteristics[0]?.enabled, true);
	});
});
