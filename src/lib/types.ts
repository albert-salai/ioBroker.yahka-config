import type * as utils from '@iobroker/adapter-core';

// state roles:						see https://www.iobroker.net/#en/documentation/dev/stateroles.md
// homekit services:				see https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/ServiceDefinitions.ts
// homekit characteristics:			see https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/CharacteristicDefinitions.ts

// SrvCharacteristic: one yahka characteristic of a service
export interface SrvCharacteristic {
	name: string;
	enabled?: boolean;
	inOutFunction: string;
	inOutParameters:
		| string
		| boolean
		| number
		| {
				readState: string;
				writeState?: string;
		  }[];
	conversionFunction?: string;
	conversionParameters?: {
		toHomeKit?: string;
		toIOBroker?: string;
	};
}

// AccService: one yahka service of an accessory
export interface AccService {
	type: string;
	subType: string;
	name: string;
	characteristics: SrvCharacteristic[];
	isPrimary?: boolean;
	linkTo?: string; // primary service name
}

// AccConfig: one yahka accessory ('name' builds the homekit UUID and must stay stable)
export interface AccConfig {
	name: string;
	category: string;
	services: AccService[];
	groupString: string;
	configType?: string;
	manufacturer?: string;
	model?: string;
	serial?: string;
	firmware?: string;
	availableState?: string;
	enabled?: boolean;
}

// ZigbeeFeature (only the fields used here)
export interface ZigbeeFeature {
	name: string;
	type: string;
	features?: ZigbeeFeature[];
}

// ZigbeeExpose: either a plain feature, or a group with 'features' (light, switch, climate, cover, lock, fan, composite, ...)
export interface ZigbeeExpose {
	type: string;
	name?: string;
	features?: ZigbeeFeature[];
}

// ZigbeeDevice
//		see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L812
export interface ZigbeeDevice {
	ieee_address: string;
	friendly_name: string;
	//	see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L876
	definition: {
		// null for unsupported devices
		model: string;
		vendor: string;
		exposes: ZigbeeExpose[];
	} | null;
	software_build_id?: string;
	model_id: string;
}

// GeneratorAdapter: the part of the adapter used by the generators
export type GeneratorAdapter = Pick<
	utils.AdapterInstance,
	'log' | 'getForeignObjectsAsync' | 'getForeignObjectAsync' | 'getForeignStateAsync'
>;

// GeneratorContext
export interface GeneratorContext {
	adapter: GeneratorAdapter;
	srcInstId: string; // source instance, e.g. 'zigbee2mqtt.0'
}

// GeneratorResult: result of one generator
export interface GeneratorResult {
	devices: AccConfig[];
	invalid: string[]; // names of devices that exist at the source but cannot be generated
	historyIds: string[]; // state ids to enable history for
}

// Generator: creates the yahka accessories of one source instance
export type Generator = (ctx: GeneratorContext) => Promise<GeneratorResult>;

// ~~~~~~~~
// AccCatId
// ~~~~~~~~
// HAP accessory categories (hap-nodejs `Categories`), yahka stores the id as string; add entries as generators need them
export const AccCatId = {
	FAN: '3',
	GARAGE_DOOR_OPENER: '4',
	LIGHTBULB: '5',
	DOOR_LOCK: '6',
	SWITCH: '8',
	THERMOSTAT: '9',
	SENSOR: '10',
} as const;
