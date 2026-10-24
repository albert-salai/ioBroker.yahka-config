import type { AccConfig } from './types';

// applyDefaults(devs): fills in default accessory fields and enables all characteristics
export function applyDefaults(devs: AccConfig[]): void {
	for (const dev of devs) {
		Object.assign(dev, Object.assign({
			'configType':		'customdevice',
			'manufacturer':		'n/a',				// visible within iOS home app
			'model':			'n/a',				// visible within iOS home app
			'serial':			'n/a',				// visible within iOS home app
			'firmware':			'n/a',				// visible within iOS home app
			'enabled':			true,
		}, dev));
		for (const service of dev.services) {
			for (const characteristic of service.characteristics) {
				characteristic.enabled = true;
			}
		}
	}
}


// mergeDevices(oldDevs, createdDevs, invalid): keeps the order of oldDevs, flags missing ones obsolete,
// disables invalid ones (names the source reports but cannot generate), appends new ones
export function mergeDevices(oldDevs: AccConfig[], createdDevs: AccConfig[], invalid: string[] = []): { newDevs: AccConfig[], disabled: string[], obsolete: string[], added: string[] } {
	const newDevs:	AccConfig[]	= [];
	const disabled:	string[]	= [];
	const obsolete:	string[]	= [];
	const added:	string[]	= [];

	// add newDev if existing in oldDevs
	for (const oldDev of oldDevs) {
		const createdDev = createdDevs.find((createdDev) => (createdDev.name === oldDev.name));
		if (createdDev) {
			createdDev.enabled = oldDev.enabled ?? false;
			if (! createdDev.enabled) {
				createdDev.groupString = '~disabled~';
				disabled.push(createdDev.name);
			}
			newDevs.push(createdDev);
		} else if (invalid.includes(oldDev.name)) {
			newDevs.push(Object.assign({}, oldDev, {
				enabled:		false,
				groupString:	'~disabled~'
			}));
			disabled.push(oldDev.name);
		} else {
			newDevs.push(Object.assign({}, oldDev, {
				enabled:		false,
				groupString:	'~obsolete~'
			}));
			obsolete.push(oldDev.name);
		}
	}

	// add createdDev if not existing in oldDevs
	for (const createdDev of createdDevs) {
		if (! oldDevs.find((oldDev) => (oldDev.name === createdDev.name))) {
			newDevs.push(createdDev);
			added.push(createdDev.name);
		}
	}

	return { newDevs, disabled, obsolete, added };
}
