import * as utils					from '@iobroker/adapter-core';
import   mqtt 						from 'mqtt';
import { diff as deepDiff }			from 'deep-diff';
import { sprintf }					from 'sprintf-js';

// mqtt used to get ZigbeeDevice list
// state roles:						see https://www.iobroker.net/#en/documentation/dev/stateroles.md
// homekit services:				see https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/ServiceDefinitions.ts
// homekit characteristics:			see https://github.com/homebridge/HAP-NodeJS/blob/latest/src/lib/definitions/CharacteristicDefinitions.ts

// SrvCharacteristic
interface SrvCharacteristic {
	name:					string,
	enabled?:				boolean,
	inOutFunction:			string,
	inOutParameters:		string | boolean | number,
	conversionFunction?:	string,
	conversionParameters?:	{ toHomeKit?: string, toIOBroker?: string },
}

// AccService
interface AccService {
	type:					string,
	subType:				string,
	name:					string,
	characteristics:		SrvCharacteristic[],
	isPrimary?:				boolean,
	linkTo?:				string,			// primary service name
}

// AccConfig
interface AccConfig {
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

// ZigbeeFeature
interface ZigbeeFeature {
	access:					number,
	description?:			string,
	label:					string,
	name:					string,
	type:					'binary' | 'numeric' | 'enum' | 'composite',
	features?:				ZigbeeFeature[],
};

// ZigbeeFeatures
interface ZigbeeFeatures {
	type:					'light' | 'composite';		// | 'switch' | 'lock' | 'list' | 'text' | 'cover' | 'fan' | 'climate',
	features:				ZigbeeFeature[],
};

// ZigbeeDevice
//		see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L812
interface ZigbeeDevice {
	ieee_address:			string,
	type:					'EndDevice' | 'Router',
	network_address:		number,
	supported:				boolean,
	friendly_name:			string,
	disabled:				boolean,
	//	see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L876
	definition: {
		model:				string,
		vendor:				string,
		description:		string,
		exposes:			(ZigbeeFeatures | ZigbeeFeature)[],
		supports_ota:		boolean,
		options:			Record<string, unknown>[],
		icon?:				string,
	},
	power_source:			'Battery' | 'Mains (single phase)',
	software_build_id?:		string,
	model_id:				string,
	interviewing:			boolean,
	interview_completed:	boolean,
	manufacturer:			string,
	endpoints:				Record<string, unknown>[],
};


// ~~~~~~~~
// AccCatId
// ~~~~~~~~
// see iobroker.yahka/io-package.json: objects.native
const AccCatId = {
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


// ~~~~~~~~~~~
// YahkaConfig
// ~~~~~~~~~~~
class YahkaConfig extends utils.Adapter {
	private historyId = '';

	// CONSTRUCTOR
	public constructor(options: Partial<utils.AdapterOptions> = {}) {
		super({
			...options,
			name: 'yahka-config',
		});
		this.on('ready',  this.onReady .bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		const mapping = this.config.mapping;

		// historyId
		const systemConfig = await this.getForeignObjectAsync('system.config');
		if (systemConfig) {
			this.historyId = systemConfig.common.defaultHistory || '';
		}

		// yahka dstId
		for (const [ dstId, srcIdsObj ] of Object.entries(mapping)) {
			const yahkaDst = await this.getForeignObjectAsync('system.adapter.' + dstId);
			if (! yahkaDst) {
				this.log.warn(sprintf('%-31s %-20s %-50s', 'onReady()', ('system.adapter.'+dstId), 'not installed'));
				// eslint-disable-next-line @typescript-eslint/no-dynamic-delete
				delete mapping[dstId];

			} else {
				for (const [ srcInstId, enabled ] of Object.entries(srcIdsObj)) {
					this.log.info(sprintf('%-31s %-20s %-50s %s', 'onReady()', dstId, srcInstId, (enabled ? 'enabled' : 'skipped')));
				}

				// oldDevs		-		yahka adapter uses 'name' to build homekit UUID
				const native = yahkaDst.native as Record<string, unknown>;
				const bridge = (native['bridge'] ? native['bridge'] : {}) as { devices?: AccConfig[] };
				const oldDevs: AccConfig[] = bridge.devices ?? [];

				// createdDevs
				let createdDevs: AccConfig[] = [];

				for (const [ srcInstId, enabled ] of Object.entries(srcIdsObj)) {
					if (enabled) {
						const adapter = srcInstId.split('.')[0];
						if		(adapter === 'danfossicon'	)	{ createdDevs = createdDevs.concat(await this.create_danfoss	(srcInstId, yahkaDst)); }
						else if (adapter === 'fritzdect'	)	{ createdDevs = createdDevs.concat(await this.create_fritzdect	(srcInstId, yahkaDst)); }
						else if (adapter === 'rpi-io'		)	{ createdDevs = createdDevs.concat(await this.create_by_role	(srcInstId, yahkaDst)); }
						else if (adapter === 'shelly'		)	{ createdDevs = createdDevs.concat(await this.create_shelly		(srcInstId, yahkaDst)); }
						else if (adapter === 'tr-064'		)	{ createdDevs = createdDevs.concat(await this.create_tr064		(srcInstId, yahkaDst)); }
						else if (adapter === 'zigbee2mqtt'	)	{ createdDevs = createdDevs.concat(await this.create_zigbee2mqtt(srcInstId, yahkaDst)); }
						else if (adapter === 'switchboard-io')	{ createdDevs = createdDevs.concat(await this.create_by_role	(srcInstId, yahkaDst)); }
					}
				}

				// enable all characteristics
				for (const createdDev of createdDevs) {
					// defaults
					Object.assign(createdDev, Object.assign({
						'configType':		'customdevice',
						'manufacturer':		'n/a',				// visible within iOS home app
						'model':			'n/a',				// visible within iOS home app
						'serial':			'n/a',				// visible within iOS home app
						'firmware':			'n/a',				// visible within iOS home app
						'enabled':			true,
					}, createdDev));
					for (const service of createdDev.services) {
						for (const characteristic of service.characteristics) {
							characteristic.enabled = true;
						}
					}
				}

				// add newDev if existing in yahkaOldDevs
				const newDevs: AccConfig[] = [];
				for (const oldDev of oldDevs) {
					const createdDev = createdDevs.find((createdDev) => (createdDev.name === oldDev.name));
					if (createdDev) {
						createdDev.enabled = oldDev.enabled ?? false;
						if (! createdDev.enabled) {
							createdDev.groupString = '~disabled~'
							this.log.info(sprintf('%-31s %-20s %-30s', 'createYahkaConfig()', 'disabled', createdDev.name));
						}
						newDevs.push(createdDev);
					} else {
						newDevs.push(Object.assign({}, oldDev, {
							enabled:		false,
							groupString:	'~obsolete~'
						}));
						this.log.info(sprintf('%-31s %-20s %-30s', 'createYahkaConfig()', 'obsolete', oldDev.name));
					}
				}

				// add createdDev if not existing in oldDevs
				for (const createdDev of createdDevs) {
					if (! oldDevs.find((oldDev) => (oldDev.name === createdDev.name))) {
						newDevs.push(createdDev);
						this.log.info(sprintf('%-31s %-20s %-30s', 'createYahkaConfig()', 'added', createdDev.name));
					}
				}
				//this.log.debug(sprintf('%-31s %-20s\n%s', 'createYahkaConfig()', 'oldDevs', JSON.stringify(oldDevs, null, 4)));
				//this.log.debug(sprintf('%-31s %-20s\n%s', 'createYahkaConfig()', 'newDevs', JSON.stringify(newDevs, null, 4)));

				// log diffs between oldDevs and newDevs
				const diffs = deepDiff(oldDevs, newDevs);
				for (const diff of (diffs ?? [])) {
					if (diff.path) {
						const pathStr = diff.path.map((val) => (typeof val === 'number' ? `[${String(val)}]` : `.${String(val)}`)).join('');
						if		(diff.kind === 'N')		{ this.log.info(sprintf('%-31s %-20s %-30s %s',					'createYahkaConfig()', 'added',   pathStr, JSON.stringify(diff.rhs))); }
						else if (diff.kind === 'D')		{ this.log.info(sprintf('%-31s %-20s %-30s %s',					'createYahkaConfig()', 'deleted', pathStr, JSON.stringify(diff.lhs))); }
						else if (diff.kind === 'E')		{ this.log.info(sprintf('%-31s %-20s %-30s %-20s --> %-10s',	'createYahkaConfig()', 'edited',  pathStr, JSON.stringify(diff.lhs), JSON.stringify(diff.rhs))); }
						else /*  diff.kind === 'A' */	{ this.log.info(sprintf('%-31s %-20s %-30s %s',					'createYahkaConfig()', 'changed', pathStr, JSON.stringify(diff.item))); }
					}
				}

				// save
				if (diffs) {
					this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', dstId, 'saving yahka devices ...', ''));
					if (yahkaDst.native['bridge']) {
						(yahkaDst.native['bridge'] as Record<string, unknown>)['devices'] = newDevs;
						await this.setForeignObject('system.adapter.' + dstId, yahkaDst);
					}
				}
			}
		}

		// stop until next schedule
		this.terminate('yahka config updated. adapter stopped until next scheduled moment');
	}


	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 * @returns
	 */
	private async create_tr064(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];

		// collect source state objects
		const stateObjs  = await this.getForeignObjectsAsync(`${srcInstId}.states.*`, 'state');
		for (const state of Object.values(stateObjs).sort(sortBy('_id'))) {
			const idPath = state._id.split('.');			// [ 'tr-064', '0', 'states', 'wps' ]
			if (state.common.type === 'boolean'  &&  ! [ 'wlan', 'wlan24', 'wlan50' ].includes(idPath.slice(-1)[0] ?? '')) {

				const accConfig = {
					'category':			AccCatId.Switch,
					'name':				state._id,								// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
					'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
					'model':			(typeof state.common.name === 'string') ? state.common.name: state.common.name.en,		// visible within iOS home app
					'services':			[] as AccService[],
					'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
				};
				accConfigs.push(accConfig);

				const accService: AccService = {
					'type': 'Switch', 'subType': '', 'name': accConfig.model,
					'characteristics': [
						{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': accConfig.model	},
						{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': state._id		}
					]
				};
				accConfig.services.push(accService);
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_tr064()', accService.type, accConfig.name, accService.name));
			}
		}

		return accConfigs;
	}


	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 * @returns
	 */
	private async create_fritzdect(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];

		// fritzdect channels
		const channels = await this.getForeignObjectsAsync(`${srcInstId}.*`, 'channel');
		for (const channel of Object.values(channels)) {
			const productname = await this.getForeignStateAsync(`${channel._id}.productname`);
			if (productname) {
				// accCategory, srvType, characteristics
				let accCategory	= '';
				let srvType		= '';
				const characteristics: SrvCharacteristic[] = [];

				// FRITZ!DECT Repeater 100
				if (productname.val === 'FRITZ!DECT Repeater 100') {
					accCategory = AccCatId.Sensor;
					srvType		= 'TemperatureSensor';
					characteristics.push({
						'name': 'CurrentTemperature', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${channel._id}.celsius`
					});
					await this.enableHistory(`${channel._id}.celsius`);

				// FRITZ!Smart Energy 200
				} else if (productname.val === 'FRITZ!Smart Energy 200') {
					accCategory = AccCatId.Switch;
					srvType		= 'Switch';
					characteristics.push({
						'name': 'On', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${channel._id}.state`
					});
					await this.enableHistory(`${channel._id}.state`);

				// FRITZ!Smart Thermo 301
				} else if (productname.val === 'FRITZ!Smart Thermo 301') {
					accCategory = AccCatId.Thermostat;
					srvType		= 'Thermostat';
					characteristics.push(
						{ 'name': 'TemperatureDisplayUnits',	'inOutFunction': 'const',					'inOutParameters': '0', 								},
						{ 'name': 'TargetTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': channel._id+'.tsoll'					},
						{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': channel._id+'.tist'					},
						{ 'name': 'TargetHeatingCoolingState',	'inOutFunction': 'const',					'inOutParameters': 3									},
						{ 'name': 'CurrentHeatingCoolingState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': channel._id+'.heatingCoolingState'	},
					);														// TargetHeatingCoolingState:	0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
					await this.enableHistory(`${channel._id}.tsoll`);		// CurrentHeatingCoolingState:	0 := OFF, 1 := HEAT, 2 := COOL
					await this.enableHistory(`${channel._id}.tist` );

				} else {
					this.log.error(sprintf('%-30s %-20s %-50s', 'create_fritzdect()', 'unknown', 'productname', productname.val));
				}

				// add devConfig
				if (! accCategory) {
					this.log.error(sprintf('%-30s %-20s %-50s %s', 'create_fritzdect()', 'missing', 'accCategory', productname.val));

				} else if (! srvType) {
					this.log.error(sprintf('%-30s %-20s %-50s %s', 'create_fritzdect()', 'missing', 'srvType', productname.val));

				} else {
					const idPath	= channel._id.split('.');						// [ 'fritzdect', '0', '0.DECT_099950049519' ]
					const grpName	= idPath.slice(0, 2).join('.');
					const nameObj	= await this.getForeignStateAsync(`${channel._id}.name`);
					const devName	= (typeof nameObj?.val === 'string') ? nameObj.val : 'unknown';

					// add Name characteristic
					characteristics.push({
						'name': 'Name', 'inOutFunction': 'const', 'inOutParameters': devName
					});

					// accConfig
					const manufacturer	= await this.getForeignStateAsync(`${channel._id}.manufacturer`);
					const fwVersion		= await this.getForeignStateAsync(`${channel._id}.fwversion`);
					const accConfig: AccConfig = {
						'category':			accCategory,
						'groupString':		grpName,								// used by adapter only
						'name':				channel._id,							// NOTE: yahka adapter uses 'name' to build homekit UUID!
						'manufacturer':		String(manufacturer?.val ?? 'n/a'),		// visible within iOS home app
						'model':			devName,								// visible within iOS home app
						'firmware':			String(fwVersion   ?.val ?? 'n/a'),		// visible within iOS home app
						'serial':			idPath[2] ?? '',						// visible within iOS home app
						'services':			[],
					};
					accConfigs.push(accConfig);

					// accService
					const accService: AccService = {
						'type': srvType, 'subType': '', 'name': devName, 'characteristics':	characteristics
					};
					accConfig.services.push(accService);
					this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_fritzdect()', accService.type, accConfig.name, accService.name));
				}
			}
		}

		return accConfigs;
	}

	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 * @returns
	 */
	private async create_shelly(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];

		// collect source state objects
		const lightChannels	= await this.getForeignObjectsAsync(`${srcInstId}.*.lights`, 'channel');
		const relayChannels	= await this.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, 'channel');
		const channels		= Object.values(lightChannels).concat(Object.values(relayChannels)).sort(sortBy('_id'));

		// channels
		for (const channel of channels) {
			const idPath	= channel._id.split('.');					// [ 'shelly', '0', 'SHDM-2#94B97E16BE61#1',	'lights' ]
			const name	= (typeof channel.common.name === 'string') ? channel.common.name : channel.common.name.en;		// [ 'shelly', '0', 'SHPLG-S#6A0761#1',			'Relay0' ]

			// accCategory, srvType, characteristics
			let accCategory								= '';			//accCatIds[expose.type]
			let srvType									= '';
			const characteristics: SrvCharacteristic[]	= [];

			// Relay
			if ((idPath[3] ?? '').startsWith('Relay')) {
				accCategory = AccCatId.Switch;
				srvType		= 'Switch';
				characteristics.push({
					'name': 'On', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${channel._id}.Switch`
				});

			// lights
			} else if (idPath[3] === 'lights') {
				accCategory = AccCatId.Lightbulb;
				srvType		= 'Lightbulb';
				characteristics.push({
					'name': 'On', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${channel._id}.Switch`
				});
				characteristics.push({
					'name': 'Brightness',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${channel._id}.brightness`
				});
			}

			// add devConfig
			if (accCategory  &&  srvType) {
				// name
				characteristics.push({
					'name': 'Name', 'inOutFunction': 'const', 'inOutParameters': name
				});

				// accConfig
				const accConfig: AccConfig = {
					'groupString':		srcInstId,				// used by adapter only
					'name':				name,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'category':			accCategory,
					'manufacturer':		'shelly',				// visible within iOS home app
					'serial':			idPath.slice(2, 4).join('.'),				// visible within iOS home app
					'availableState':	`${idPath.slice(0, 3).join('.')}.online`,
					'services':			[],
				};
				accConfigs.push(accConfig);

				// accService
				const accService: AccService = {
					'type': srvType, 'subType': '', 'name': name, 'characteristics':	characteristics
				};
				accConfig.services.push(accService);
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_shelly()', accService.type, accConfig.name, accService.name));
			}
		}

		return accConfigs;
	}

	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 */
	private async create_by_role(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];

		const pinObjs = await this.getForeignObjectsAsync(`${srcInstId}.*`, 'state');
		for (const pinObj of Object.values(pinObjs).sort(sortBy('_id'))) {
			const objId		= pinObj._id;									//   '0_userdata.0.pin.tür_tag'
			const idPath	= pinObj._id.split('.');						// [ '0_userdata', '0', 'pin', 'tür_tag' ]
			const objRole	= pinObj.common.role;							// 'value.temperature'
			const objName	= (typeof pinObj.common.name === 'string') ? pinObj.common.name : pinObj.common.name.en;		// 'Haustür'

			// yahka device config
			const accConfig: AccConfig = {
				'category':			'',
				'name':				objId,									// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
				'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
				'model':			objName,								// visible within iOS home app
				'services':			[],										// default
				'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
			};

			// sensor.contact
			if (objRole === 'sensor.contact') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'ContactSensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'ContactSensorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	},
						]
					}
				];

			// sensor.motion
			} else if (objRole === 'sensor.motion') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'MotionSensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'MotionDetected',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			// sensor.occupancy
			} else if (objRole === 'sensor.occupancy') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'OccupancySensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'OccupancyDetected',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			// sensor.leak
			} else if (objRole === 'sensor.leak') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'LeakSensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',			'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'LeakDetected',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			// switch
			} else if (objRole === 'switch') {
				accConfig.category = AccCatId.Switch;
				accConfig.services = [
					{
						'type': 'Switch', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

				// switch.light
			} else if (objRole === 'switch.light') {
				accConfig.category = AccCatId.Lightbulb;
				accConfig.services = [
					{
						'type': 'Lightbulb', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			// switch.lock.door
			} else if (objRole === 'switch.lock.door') {
				accConfig.category	= AccCatId.Door_lock;
				accConfig.services = [
					{
						'type': 'LockMechanism', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName											},
							{ 'name': 'LockTargetState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId,			'conversionFunction': 'invert'	},
							{ 'name': 'LockCurrentState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId+'_status',	'conversionFunction': 'invert'	},
						]
					}
				];

			// switch.garage
			} else if (objRole === 'switch.garage') {
				accConfig.category	= AccCatId.Garage_door_opener ;
				accConfig.services = [
					{
						'type': 'GarageDoorOpener', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName											},
							{ 'name': 'TargetDoorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId,			'conversionFunction': 'invert'	},
							{ 'name': 'CurrentDoorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId+'_status',	'conversionFunction': 'invert'	},
							{ 'name': 'ObstructionDetected','inOutFunction': 'const',					'inOutParameters': false											},
						]
					}
				];

			// switch.fan
			} else if (objRole === 'switch.fan') {
				accConfig.category = AccCatId.Fan;
				accConfig.services = [
					{
						'type': 'Fan', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];
			}

			// add accConfig
			if (accConfig.services.length > 0) {
				accConfigs.push(accConfig);
				for (const accService of accConfig.services) {
					this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_by_role()', accService.type, accConfig.name, accService.name));
				}
			}
		}

		return accConfigs;
	}


	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 */
	private async create_danfoss(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];
		const group = srcInstId;										// 'danfossicon.0'

		// danfossicon HousePause
		const housePause = await this.getForeignObjectAsync(`${srcInstId}.House.HousePause`);
		if (housePause) {
			const idPath	= housePause._id.split('.');				// [ 'danfossicon', '0', 'House', 'HousePause' ]
			const name		= (typeof housePause.common.name === 'string') ? housePause.common.name : housePause.common.name.en;

			const accConfig = {
				'groupString':		group,								// used only by iobroker adapter to group accessiries
				'name':				housePause._id,						// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		group,								// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
				'category':			AccCatId.Switch,
				'services':			[] as AccService[],
			};
			const accService: AccService = {
				'type': 'Switch', 'subType': '', 'name': accConfig.model,
				'characteristics': [
					{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': name				},
					{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': housePause._id	}
				]
			};
			accConfig.services.push(accService);
			accConfigs.push(accConfig);
			this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_danfoss()', accService.type, accConfig.name, accService.name));
		}

		// TargetTemp
		const targetTemps = await this.getForeignObjectsAsync(`${srcInstId}.room-*.TargetTemp`, 'state');
		for (const targetTempObj of Object.values(targetTemps).sort(sortBy('_id'))) {
			const idPath	= targetTempObj._id.split('.');				// [ 'danfossicon', '0', 'room-01', 'TargetTemp' ]
			const idBase	= idPath.slice(0, -1).join('.');			//   'danfossicon.0.room-01''
			const name		= (typeof targetTempObj.common.name === 'string') ? targetTempObj.common.name : targetTempObj.common.name.en;

			const accConfig = {
				'category':			AccCatId.Thermostat,
				'name':				targetTempObj._id,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		group,								// visible within iOS home app
				'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'services':			[] as AccService[],
				'groupString':		group,								// used by adapter only
				'availableState':	`${group}.House.PeerConnected`,
			};
			accConfigs.push(accConfig);

			const accService: AccService = {
				'type': 'Thermostat', 'subType': '', 'name': name,
				'characteristics': [
					{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': name						},
					{ 'name': 'TargetTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.TargetTemp'		},
					{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.RoomTemp'		},
					{ 'name': 'TemperatureDisplayUnits',	'inOutFunction': 'const',					'inOutParameters': '0', 					},
					{ 'name': 'TargetHeatingCoolingState',	'inOutFunction': 'const',					'inOutParameters': '3', 					},
					{ 'name': 'CurrentHeatingCoolingState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.ValveState',
						'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value) ? 1 : 2;', 'toIOBroker': 'return (value == 1);' }
					}		// TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
				]			// CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
			};
			accConfig.services.push(accService);
			this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_danfoss()', accService.type, accConfig.name, accService.name));
		}

		return accConfigs;
	}


	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 * @returns
	 */
	private async create_zigbee2mqtt(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];

		// zigbeeDevs
		const zigbeeDevs = await new Promise<ZigbeeDevice[]>((resolve, _reject) => {
			const client = mqtt.connect('mqtt://127.0.0.1:1883');
			client.on('connect', (_pkt: mqtt.IConnackPacket) => {
				client
					.on('message', (_topic: string, payload: Buffer, _pkt: mqtt.IPublishPacket) => {
						client.end();
						resolve(JSON.parse(payload.toString()) as ZigbeeDevice[]);
					})
					.subscribe('zigbee2mqtt/bridge/devices');
			});
		});
		//this.log.debug(sprintf('%-30s %-20s %-50s\n%s', 'create_zigbee2mqtt()', 'zigbeeDevs', '', JSON.stringify(zigbeeDevs, null, 4)));

		// mqttDevs
		const iobDevs = await this.getForeignObjectsAsync(`${srcInstId}.*`, 'device');
		for (const iobDev of Object.values(iobDevs)) {
			const idPath	= iobDev._id.split('.');			// [ 'zigbee2mqtt', '0', '0x680ae2fffe14a2cb' ]
			const ieeeAdr	= idPath.slice(-1)[0];
			const zigbeeDev	= zigbeeDevs.find(dev => (dev.ieee_address === ieeeAdr));
			if (zigbeeDev) {
				//this.log.debug(sprintf('%-30s %-20s %-50s\n%s', 'create_zigbee2mqtt()', 'zigbeeDev', '', JSON.stringify(zigbeeDev, null, 4)));

				// zigbeeDev
				const { ieee_address, network_address, supported, friendly_name, disabled, definition, software_build_id, model_id, interviewing, interview_completed, manufacturer, endpoints } = zigbeeDev;
				if (typeof ieee_address			!== 'string'	) { throw new Error('device ieee_address must be string'			); }
				if (typeof network_address		!== 'number'	) { throw new Error('device network_address must be number'			); }
				if (typeof supported			!== 'boolean'	) { throw new Error('device supported must be boolean'				); }
				if (typeof friendly_name		!== 'string'	) { throw new Error('device friendly_name must be string'			); }
				if (typeof disabled				!== 'boolean'	) { throw new Error('device disabled must be boolean'				); }
				if (typeof definition			!== 'object'	) { throw new Error('device definition must be object'				); }
				if (typeof model_id				!== 'string'	) { throw new Error('device model_id must be string'				); }
				if (typeof interviewing			!== 'boolean'	) { throw new Error('device interviewing must be boolean'			); }
				if (typeof interview_completed	!== 'boolean'	) { throw new Error('device interview_completed must be boolean'	); }
				if (typeof manufacturer			!== 'string'	) { throw new Error('device manufacturer must be string'			); }
				if (typeof endpoints			!== 'object'	) { throw new Error('device endpoints must be object'				); }

				// zigbeeDev.definition
				const { model, vendor, description, exposes, supports_ota, options } = zigbeeDev.definition;
				if (typeof model				!== 'string'	) { throw new Error('definition model must be string'				); }
				if (typeof vendor				!== 'string'	) { throw new Error('definition vendor must be string'				); }
				if (typeof description			!== 'string'	) { throw new Error('definition description must be string'			); }
				if (typeof exposes				!== 'object'	) { throw new Error('definition exposes must be object'				); }
				if (typeof supports_ota			!== 'boolean'	) { throw new Error('definition supports_ota must be boolean'		); }
				if (typeof options				!== 'object'	) { throw new Error('definition options must be object'				); }

				// zigbeeDev.definition.exposes
				const checkFeature = (feature: ZigbeeFeature): void => {
					const { access, label, name, type } = feature;
					if (typeof access		!== 'number') { throw new Error('feature access must be number'		); }
					if (typeof label		!== 'string') { throw new Error('feature label must be string'		); }
					if (typeof name			!== 'string') { throw new Error('feature name must be string'		); }
					if (! [ 'binary', 'numeric', 'enum', 'composite' ].includes(type)	) { throw new Error(`invalid feature type ${type}`		); }
				};
				for (const expose of exposes) {
					if ([ 'light', 'composite' ].includes(expose.type)  &&  Array.isArray(expose.features)) {
						for (const feature of expose.features) {
							checkFeature(feature);
						}
					} else {
						checkFeature(expose as ZigbeeFeature);
					}
				}

				// accConfig
				const grpName = idPath.slice(0, 2).join('.');
				const devName = friendly_name;
				const accConfig: AccConfig = {
					'groupString':		grpName,								// used only by iobroker adapter to group accessiries
					'name':				`${grpName}.${devName}`,				// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'model':			devName,								// visible within iOS home app
					'manufacturer':		`${vendor} ${model_id} (${model})`,		// visible within iOS home app
					'serial':			ieee_address,							// visible within iOS home app
					'firmware':			software_build_id  ??  'n/a',			// visible within iOS home app
					'category':			'',										// accCatIds[expose.type]
					'services':			[],
					'availableState':	`${iobDev._id}.available`,
				};
				//this.log.debug(sprintf('%-30s %-20s %-50s\n%s', 'create_zigbee2mqtt()', 'accConfig', '', JSON.stringify(accConfig, null, 4)));

				// typedFeatures, features, featureNames, exposedLight
				const features		= exposes.filter(expose => 'name'     in expose);
				const featureNames	= features.map(feature => feature.name);
				const typedFeatures	= exposes.filter(expose => 'features' in expose);
				const exposedLight	= typedFeatures.find(expose => (expose.type === 'light'));
				//this.log.debug(sprintf('%-30s %-20s %-50s %s\n%s', 'create_zigbee2mqtt()', `featureNames`, iobDev._id, zigbeeDev.friendly_name, JSON.stringify(featureNames, null, 4)));

				// Service Lightbulb
				if (exposedLight) {
					const characteristics: SrvCharacteristic[] = [];
					for (const feature of exposedLight.features  ??  []) {
						if (feature.name === 'state') {
							characteristics.push({
								'name': 'On', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.state`
							});

						} else if (feature.name === 'brightness') {
							characteristics.push({
								'name': 'Brightness', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.brightness`
							});

						} else if (feature.name === 'color_temp') {
							characteristics.push({
								'name': 'ColorTemperature',	'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.colortemp`,
								'conversionFunction':	'script',
								'conversionParameters': {
									'toHomeKit':		'return Math.max(153, value)',
									'toIOBroker':		'return Math.max(153, value)'
								}
							});
						}
					}

					accConfig.category = AccCatId.Lightbulb;
					accConfig.services.push({
						'type': 'Lightbulb', 'subType': '', 'name': devName, 'characteristics':	characteristics
					});

 				// Service ContactSensor (+ Battery)
				} else if (featureNames.includes('contact')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor ContactSensor
						if (feature.name === 'contact') {
							const characteristics: SrvCharacteristic[] = [{
								'name': 'ContactSensorState', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters':	`${iobDev._id}.opened`
							}];
							accConfig.services.push({
								'type': 'ContactSensor', 'subType': '', 'name': devName, 'characteristics':	characteristics,
								'isPrimary': true
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							const characteristics: SrvCharacteristic[] = [
								{
									'name': 'BatteryLevel',		'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`
								}, {
									'name': 'StatusLowBattery',	'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`,
									'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
								}
							];
							accConfig.services.push({
								'type': 'Battery', 'subType': '', 'name': `${devName} Batterie`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}
					}

				// Service LeakSensor (+ Battery)
				} else if (featureNames.includes('water_leak')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor LeakSensor
						if (feature.name === 'water_leak') {
							const characteristics: SrvCharacteristic[] = [{
								'name': 'LeakDetected', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.detected`
							}];
							accConfig.services.push({
								'type': 'LeakSensor', 'subType': '', 'name': devName, 'characteristics': characteristics,
								'isPrimary': true
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							const characteristics: SrvCharacteristic[] = [
								{
									'name': 'BatteryLevel',		'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`
								}, {
									'name': 'StatusLowBattery',	'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`,
									'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
								}
							];
							accConfig.services.push({
								'type': 'Battery', 'subType': '', 'name': `${devName} Batterie`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}
					}

				// Service OccupancySensor (+ LightSensor + Battery)
				} else if (featureNames.includes('occupancy')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor OccupancySensor
						if (feature.name === 'occupancy') {
							const characteristics: SrvCharacteristic[] = [{
								'name': 'OccupancyDetected', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.occupancy`
							}];
							accConfig.services.push({
								'type': 'OccupancySensor', 'subType': '', 'name': devName, 'characteristics': characteristics,
								'isPrimary': true
							});
						}

						// Sensor LightSensor
						if (feature.name === 'illuminance') {
							const characteristics: SrvCharacteristic[] = [
								{
									'name': 'CurrentAmbientLightLevel', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.illuminance_raw`
								}
							];
							accConfig.services.push({
								'type': 'LightSensor', 'subType': '', 'name': `${devName} Helligkeit`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							const characteristics: SrvCharacteristic[] = [
								{
									'name': 'BatteryLevel',		'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`
								}, {
									'name': 'StatusLowBattery',	'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`,
									'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
								}
							];
							accConfig.services.push({
								'type': 'Battery', 'subType': '', 'name': `${devName} Batterie`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}
					}

				// Service HumiditySensor (+ TemperatureSensor + Battery)
				} else if (featureNames.includes('humidity')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor humidity
						if (feature.name === 'humidity') {
							const characteristics: SrvCharacteristic[] = [{
								'name': 'CurrentRelativeHumidity', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.humidity`
							}];
							accConfig.services.push({
								'type': 'HumiditySensor', 'subType': '', 'name': devName, 'characteristics': characteristics,
								'isPrimary': true
							});
						}

						// Sensor temperature
						if (feature.name === 'temperature') {
							const characteristics: SrvCharacteristic[] = [{
								'name': 'CurrentTemperature', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.temperature`
							}];
							accConfig.services.push({
								'type': 'TemperatureSensor', 'subType': '', 'name': `${devName} Temperatur`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							const characteristics: SrvCharacteristic[] = [
								{
									'name': 'BatteryLevel',		'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`
								}, {
									'name': 'StatusLowBattery',	'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`,
									'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
								}
							];
							accConfig.services.push({
								'type': 'Battery', 'subType': '', 'name': `${devName} Batterie`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}
					}
				}

				// enable history
				if (featureNames.includes('linkquality')) {
					await this.enableHistory(`${iobDev._id}.link_quality`);
				}
				await this.enableHistory(`${iobDev._id}.available`);

				// add devConfig
				if (accConfig.category !== '') {
					// add Name characteristic to every service
					for (const accService of accConfig.services) {
						accService.characteristics.push({
							'name': 'Name', 'inOutFunction': 'const', 'inOutParameters': accService.name
						});
						this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', accService.type, accConfig.name, accService.name));
					}

					// add accessory
					accConfigs.push(accConfig);
				}
			}
		}

		//this.log.debug(sprintf('%-30s %-20s %-50s\n%s', 'create_zigbee2mqtt()', 'devConfigs', '', JSON.stringify(devConfigs, null, 4)));
		return accConfigs;
	}

	/**
	 *
	 * @param stateId
	 */
	private async enableHistory(stateId: string): Promise<void> {
		if (this.historyId) {
			const oldObj = await this.getForeignObjectAsync(stateId);
			if (oldObj?.type !== 'state') {
				this.log.warn(sprintf('%-31s %-20s %-50s', 'enableHistory()', 'missing', stateId));

			} else {
				const newObj		= JSON.parse(JSON.stringify(oldObj)) as typeof oldObj;
				const newCustom		= (newObj.common.custom			?? {});
				const newHistory	= (newCustom[this.historyId]	?? {}) as Record<string, unknown>;
				newHistory['enabled'] = true;

				// log diffs between oldDevs and newDevs
				const diffs = deepDiff(oldObj, newObj) ?? [];
				if (diffs.length > 0) {
					// debug log
					for (const diff of diffs) {
						if (diff.path) {
							const pathStr = diff.path.map((val) => (typeof val === 'number' ? `[${String(val)}]` : `.${String(val)}`)).join('');
							if		(diff.kind === 'N')		{ this.log.info(sprintf('%-31s %-20s %-30s %s',					'createYahkaConfig()', 'added',   pathStr, JSON.stringify(diff.rhs))); }
							else if (diff.kind === 'D')		{ this.log.info(sprintf('%-31s %-20s %-30s %s',					'createYahkaConfig()', 'deleted', pathStr, JSON.stringify(diff.lhs))); }
							else if (diff.kind === 'E')		{ this.log.info(sprintf('%-31s %-20s %-30s %-20s --> %-10s',	'createYahkaConfig()', 'edited',  pathStr, JSON.stringify(diff.lhs), JSON.stringify(diff.rhs))); }
							else /*  diff.kind === 'A' */	{ this.log.info(sprintf('%-31s %-20s %-30s %s',					'createYahkaConfig()', 'changed', pathStr, JSON.stringify(diff.item))); }
						}
					}

					// write newObj
					//this.log.debug(sprintf('%-30s %-20s %-50s %s', 'enableHistory()', 'common', stateId, JSON.stringify(common, null, 4)));
					await this.setForeignObject(stateId, newObj);
				}
			}
		}
	}

	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
		callback();
	}
}



// sortBy(key)
function sortBy<T>(key: keyof T): ((a: T, b: T) => number) {
	return (a: T, b: T) => (a[key] > b[key]) ? +1 : ((a[key] < b[key]) ? -1 : 0);
}



if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new YahkaConfig(options);
} else {
	// otherwise start the instance directly
	(() => new YahkaConfig())();
}
