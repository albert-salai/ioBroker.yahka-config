import type { AccService, SrvCharacteristic } from './types';


// objName(obj): display name of an object, as shown in the iOS home app;
// translated names fall back to the first available language if 'en' is missing, and to the object id if there is none
export function objName(obj: ioBroker.Object): string {
	const name = obj.common.name as string | Partial<Record<string, string>>;	// typings claim 'en' is always set
	if (typeof name === 'string') { return name; }
	return name['en'] ?? Object.values(name)[0] ?? obj._id;
}


// onlyAck(name, stateId, extra): characteristic read from / written to an ioBroker state (ack only)
export function onlyAck(name: string, stateId: string, extra: Partial<SrvCharacteristic> = {}): SrvCharacteristic {
	return { name, 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': stateId, ...extra };
}


// constChar(name, value): characteristic with a constant value
export function constChar(name: string, value: string | number | boolean): SrvCharacteristic {
	return { name, 'inOutFunction': 'const', 'inOutParameters': value };
}


// sortBy(key): comparator that orders objects ascending by the property 'key'; used to get a stable device order
export function sortBy<T>(key: keyof T): ((a: T, b: T) => number) {
	return (a: T, b: T) => (a[key] > b[key]) ? 1 : ((a[key] < b[key]) ? -1 : 0);
}


// battery level (%) below which HomeKit reports StatusLowBattery
const LOW_BATTERY_PERCENT = 10;


// batteryService(iobDevId, devName): Battery service linked to the primary service 'devName'
export function batteryService(iobDevId: string, devName: string): AccService {
	return {
		'type': 'Battery',
		'subType': '',
		'name': `${devName} Batterie`,
		'linkTo': devName,
		'characteristics': [
			onlyAck('BatteryLevel', `${iobDevId}.battery`),
			onlyAck('StatusLowBattery', `${iobDevId}.battery`, {
				'conversionFunction': 'script',
				'conversionParameters': { 'toHomeKit': `return (value < ${String(LOW_BATTERY_PERCENT)});` }
			}),
		],
	};
}
