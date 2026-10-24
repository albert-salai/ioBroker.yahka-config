import type * as utils from '@iobroker/adapter-core';

// state roles:						see https://www.iobroker.net/#en/documentation/dev/stateroles.md
// homekit services:				see https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/ServiceDefinitions.ts
// homekit characteristics:			see https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/CharacteristicDefinitions.ts

// SrvCharacteristic
export interface SrvCharacteristic {
	name:					string,
	enabled?:				boolean,
	inOutFunction:			string,
	inOutParameters:		string | boolean | number,
	conversionFunction?:	string,
	conversionParameters?:	{ toHomeKit?: string, toIOBroker?: string },
}

// AccService
export interface AccService {
	type:					string,
	subType:				string,
	name:					string,
	characteristics:		SrvCharacteristic[],
	isPrimary?:				boolean,
	linkTo?:				string,			// primary service name
}

// AccConfig
export interface AccConfig {
	name:					string,
	category:				string,
	services:				AccService[],
	groupString:			string
	configType?:			string,
	manufacturer?:			string,
	model?:					string,
	serial?:				string,
	firmware?:				string,
	availableState?:		string,
	enabled?:				boolean,
}

// ZigbeeFeature (only the fields used here)
export interface ZigbeeFeature {
	name:					string,
	type:					string,
	features?:				ZigbeeFeature[],
}

// ZigbeeExpose: either a plain feature, or a group with 'features' (light, switch, climate, cover, lock, fan, composite, ...)
export interface ZigbeeExpose {
	type:					string,
	name?:					string,
	features?:				ZigbeeFeature[],
}

// ZigbeeDevice
//		see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L812
export interface ZigbeeDevice {
	ieee_address:			string,
	friendly_name:			string,
	//	see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L876
	definition: {								// null for unsupported devices
		model:				string,
		vendor:				string,
		exposes:			ZigbeeExpose[],
	} | null,
	software_build_id?:		string,
	model_id:				string,
}



// GeneratorAdapter: the part of the adapter used by the generators
export type GeneratorAdapter = Pick<utils.AdapterInstance, 'log' | 'getForeignObjectsAsync' | 'getForeignObjectAsync' | 'getForeignStateAsync'>;

// GeneratorContext
export interface GeneratorContext {
	adapter:				GeneratorAdapter,
	srcInstId:				string,				// source instance, e.g. 'zigbee2mqtt.0'
}

// GeneratorResult: result of one generator
export interface GeneratorResult {
	devices:				AccConfig[],
	invalid:				string[],			// names of devices that exist at the source but cannot be generated
	historyIds:				string[],			// state ids to enable history for
}

// Generator
export type Generator = (ctx: GeneratorContext) => Promise<GeneratorResult>;


// ~~~~~~~~
// AccCatId
// ~~~~~~~~
// see iobroker.yahka/io-package.json: objects.native
export const AccCatId = {
	'AIRPORT':				'27',
	'AIR_CONDITIONER':		'21',
	'AIR_DEHUMIDIFIER':		'23',
	'AIR_HEATER':			'20',
	'AIR_HUMIDIFIER':		'22',
	'AIR_PURIFIER':			'19',
	'APPLE_TV':				'24',
	'AUDIO_RECEIVER':		'34',
	'Alarm_system':			'11',
	'Bridge':				'2',
	'Camera':				'17',
	'Door':					'12',
	'Door_lock':			'6',
	'FAUCET':				'29',
	'Fan':					'3',
	'Garage_door_opener':	'4',
	'HOMEPOD':				'25',
	'Lightbulb':			'5',
	'Other':				'1',
	'Outlet':				'7',
	'Programmable_switch':	'15',
	'ROUTER':				'33',
	'Range_extender':		'16',
	'SHOWER_HEAD':			'30',
	'SPEAKER':				'26',
	'SPRINKLER':			'28',
	'Sensor':				'10',
	'Switch':				'8',
	'TARGET_CONTROLLER':	'32',
	'TELEVISION':			'31',
	'TV_SET_TOP_BOX':		'35',
	'TV_STREAMING_STIC':	'36',
	'Thermostat':			'9',
	'VIDEO_DOORBELL':		'18',
	'Window':				'13',
	'Window_covering':		'14'
};
