import type { AccService, SrvCharacteristic } from './types';


// objName(obj): display name of an object, as shown in the iOS home app
export function objName(obj: ioBroker.Object): string {
	return (typeof obj.common.name === 'string') ? obj.common.name : obj.common.name.en;
}


// onlyAck(name, stateId, extra): characteristic read from / written to an ioBroker state (ack only)
export function onlyAck(name: string, stateId: string, extra: Partial<SrvCharacteristic> = {}): SrvCharacteristic {
	return { name, 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': stateId, ...extra };
}


// constChar(name, value): characteristic with a constant value
export function constChar(name: string, value: string | number | boolean): SrvCharacteristic {
	return { name, 'inOutFunction': 'const', 'inOutParameters': value };
}


// sortBy(key)
export function sortBy<T>(key: keyof T): ((a: T, b: T) => number) {
	return (a: T, b: T) => (a[key] > b[key]) ? 1 : ((a[key] < b[key]) ? -1 : 0);
}


// batteryService(iobDevId, devName): Battery service linked to the primary service 'devName'
export function batteryService(iobDevId: string, devName: string): AccService {
	return {
		'type': 'Battery', 'subType': '', 'name': `${devName} Batterie`, 'linkTo': devName,
		'characteristics': [
			onlyAck('BatteryLevel', `${iobDevId}.battery`),
			onlyAck('StatusLowBattery', `${iobDevId}.battery`, {
				'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
			}),
		],
	};
}
