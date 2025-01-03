import * as utils			from '@iobroker/adapter-core';
import YahkaIoPkgJson		from 'iobroker.yahka/io-package.json';
import { sprintf }			from 'sprintf-js';
import mqtt 				from 'mqtt';


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
	characteristics:		SrvCharacteristic[]
}

// AccConfig
interface AccConfig {
	configType:				string,
	category?:				string,
	name:					string,
	manufacturer:			string,
	serial:					string,
	model?:					string,
	firmware?:				string,
	services:				AccService[],
	enabled:				boolean,
	groupString:			string
}

// ZigbeeFeature, TypedFeatures, ZigbeeDev
type ZigbeeFeature = {
	name:				string
};
type TypedFeatures = {
	type:				'binary' | 'light' | 'numeric' | 'enum' | 'composite',
	features:			 ZigbeeFeature[],
};
type ZigbeeDev = {
	type:				string,
	ieee_address:		string,
	friendly_name:		string,
	manufacturer:		string,
	model_id:			string,
	software_build_id:	string,
	definition: {
		type:			'Router' | 'EndDevice',
		vendor:			string,
		model:			string,
		description:	string,
		exposes:		(ZigbeeFeature | TypedFeatures)[],
	}
};


// ~~~~~~~~
// AccCatId
// ~~~~~~~~
// AccCatId: { "Lightbulb": "5", "Switch": "8", "Thermostat": "9", "Sensor": "10", ... }
const AccCatId = Object.entries(YahkaIoPkgJson.objects[0].native).reduce((result: {[index: string]: string}, [key, val]) => {
	result[val.text.replace(/ /g,'_')] = key;
	return result;
}, {});


// ~~~~~~~~~~~
// YahkaConfig
// ~~~~~~~~~~~
class YahkaConfig extends utils.Adapter {
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
		this.log.info(sprintf('%-31s %-20s %-50s', 'onReady()', 'mapping', '\n'+JSON.stringify(mapping, null, 4)));

		// yahka dstId
		for (const [ dstId, srcIdsObj ] of Object.entries(mapping)) {
			const yahkaDst = await this.getForeignObjectAsync('system.adapter.' + dstId);
			if (! yahkaDst) {
				this.log.warn(sprintf('%-31s %-20s %-50s', 'onReady()', ('system.adapter.'+dstId), 'not installed'));
				delete mapping[dstId];

			} else {
				// get yahkaOldDevs		-		yahka adapter uses 'name' to build homekit UUID
				const yahkaOldDevs: AccConfig[] = yahkaDst['native']['bridge']['devices'];

				// get yahkaNewDevs
				let yahkaNewDevs: AccConfig[] = [];
				const srcInstIds = Object.entries(srcIdsObj).filter(entry => (entry[1] === true)).map(entry => entry[0]).sort();
				for (const srcInstId of srcInstIds) {
					const adapter = srcInstId.split('.')[0];
					if		(adapter === 'tr-064'		)	{ yahkaNewDevs = yahkaNewDevs.concat(await this.create_tr064		(srcInstId, yahkaDst)); }
					else if (adapter === 'fritzdect'	)	{ yahkaNewDevs = yahkaNewDevs.concat(await this.create_fritzdect	(srcInstId, yahkaDst)); }
					else if (adapter === 'shelly'		)	{ yahkaNewDevs = yahkaNewDevs.concat(await this.create_shelly		(srcInstId, yahkaDst)); }
					else if (adapter === '0_userdata'	)	{ yahkaNewDevs = yahkaNewDevs.concat(await this.create_switchboard	(srcInstId, yahkaDst)); }
					else if (adapter === 'zigbee2mqtt'	)	{ yahkaNewDevs = yahkaNewDevs.concat(await this.create_zigbee2mqtt	(srcInstId, yahkaDst)); }
					else if (adapter === 'danfoss-icon'	)	{ yahkaNewDevs = yahkaNewDevs.concat(await this.create_danfoss		(srcInstId, yahkaDst)); }
				}

				// enable all characteristics
				for (const device of yahkaNewDevs) {
					// defaults
					Object.assign(yahkaNewDevs, {
						'firmware':			'n/a',			// visible within iOS home app
					}, yahkaNewDevs);
					for (const service of device.services) {
						for (const characteristic of service.characteristics) {
							characteristic.enabled = true;
						}
					}
				}

				// sort yahkaOldDevs, yahkaNewDevs
				yahkaOldDevs.sort(sortBy('name'));
				yahkaNewDevs.sort(sortBy('name'));
				//this.log.info(sprintf('%-31s %-20s\n%s', 'createYahkaConfig()', 'yahkaOldDevs', JSON.stringify(yahkaOldDevs, null, 4)));
				//this.log.info(sprintf('%-31s %-20s\n%s', 'createYahkaConfig()', 'yahkaNewDevs', JSON.stringify(yahkaNewDevs, null, 4)));

				// copy 'enabled' state from oldDev to newDev
				for (const yahkaNewDev of  yahkaNewDevs) {
					const  yahkaOldDev  =  yahkaOldDevs.find(oldDev => (oldDev.name === yahkaNewDev.name));
					yahkaNewDev.enabled = (yahkaOldDev) ? yahkaOldDev.enabled : true;
				}

				// keep custom yahka device configs		-		yahka adapter uses 'name' to build homekit UUID
				let yahkaChanged = false;
				for (const yahkaOldDev of yahkaOldDevs) {
					const keep = ! yahkaNewDevs.some((newDev) => (newDev.name === yahkaOldDev.name));
					if (keep) {
						this.log.warn(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', 'keeping', yahkaOldDev.name, ''));
						yahkaOldDev.enabled = false;
						yahkaNewDevs.push();
					}
				}

				// yahkaChanged?						-		yahka adapter uses 'name' to build homekit UUID
				const diff = objDiff(yahkaOldDevs, yahkaNewDevs, 'yahkaDevs');
				yahkaChanged = yahkaChanged  ||  (Object.values(diff).length > 0);

				// debug
				if (Object.values(diff).length > 0) {
					this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', dstId, 'diff', '\n'+JSON.stringify(diff, null, 4)));
				}

				// save
				if (yahkaChanged) {
					this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', dstId, 'saving yahka devices ...', ''));
					//	await this.extendForeignObjectAsync(dstInst, { 'native': { 'bridge': { 'devices': yahkaNewDevs } } });
					yahkaDst['native']['bridge']['devices'] = yahkaNewDevs;
					await this.setForeignObjectAsync('system.adapter.' + dstId, yahkaDst);
				}
			}
		}


		// stop until next schedule
		this.terminate ? this.terminate('yahka config updated. adapter stopped until next scheduled moment') : process.exit(0);
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
		const stateObjs  = await this.getForeignObjectsAsync(`${srcInstId}.states.*`, 'state') || {};
		for (const state of Object.values(stateObjs).sort(sortBy('_id'))) {
			const idPath = state._id.split('.');			// [ 'tr-064', '0', 'states', 'wps' ]
			if (state.common.type === 'boolean'  &&  ! [ 'wlan', 'wlan24', 'wlan50' ].includes(idPath.slice(-1)[0])) {
				this.log.info(sprintf('%-31s %-20s %-50s %s', 'create_tr064()', 'state', state._id, state.common.name));

				const accConfig = {
					'configType':		'customdevice',
					'category':			AccCatId.Switch,
					'name':				state._id,								// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
					'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
					'model':			state.common.name.toString(),			// visible within iOS home app
					'services':			[] as AccService[],
					'enabled':			true,
					'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
				};
				accConfigs.push(accConfig);

				accConfig.services.push({
					'type': 'Switch', 'subType': '', 'name': accConfig.model,
					'characteristics': [
						{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': accConfig.model	},
						{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': state._id	}
					]
				});
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

		/*
		const productNames = await this.getForeignStatesAsync(`${srcInstId}.*.productname`);
		for (const [ prodNameId, prodNameObj ] of Object.entries(productNames)) {
			const idPath	= prodNameId.split('.');					// [ 'fritzdect', '0', 'DECT_116570168794', 'productname' ]
			const idBase	= idPath.slice(0, 2).join('.');				//   'fritzdect.0.DECT_116570168794'		(channel)
			const channel	= await this.getForeignObjectAsync(idBase);

			const productName = prodNameObj.val;

			// accCategory, srvType, characteristics
			let accCategory								= '';			//accCatIds[expose.type]
			let srvType									= '';
			const characteristics: SrvCharacteristic[]	= [];

			// FRITZ!DECT Repeater 100
			if (productName === 'FRITZ!DECT Repeater 100') {
				accCategory = AccCatId.Sensor;
				srvType		= 'TemperatureSensor';
				characteristics.push({
					'name': 'CurrentTemperature', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${idBase}.celsius`
				});

			// FRITZ!DECT 200
			} else if (productName === 'FRITZ!DECT 200') {
				accCategory = AccCatId.Switch;
				srvType		= 'Switch';
				characteristics.push({
					'name': 'On', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${idBase}.state`
				});

			// FRITZ!DECT 301
			} else if (productName === 'FRITZ!DECT 301') {

			} else {

			}

			// add devConfig
			if (accCategory  &&  srvType) {
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_shelly()', `created ${idPath[3]}`, channel._id, channel.common.name));

				// name
				characteristics.push({
					'name': 'Name', 'inOutFunction': 'const', 'inOutParameters': name
				});

				// accConfig
				const accConfig: AccConfig = {
					'configType':		'customdevice',
					'enabled':			true,
					'groupString':		srcInstId,				// used by adapter only
					'name':				name,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'category':			accCategory,
					'manufacturer':		'shelly',				// visible within iOS home app
					'serial':			idPath[2],				// visible within iOS home app
					'services':			[],
				};
				accConfigs.push(accConfig);

				// accService
				const accService: AccService = {
					'type': srvType, 'subType': '', 'name': name, 'characteristics':	characteristics
				};
				accConfig.services.push(accService);
			}
		}
		*/

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
		const lightChannels	= await this.getForeignObjectsAsync(`${srcInstId}.*.lights`, 'channel') || {};
		const relayChannels	= await this.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, 'channel') || {};
		const channels		= Object.values(lightChannels).concat(Object.values(relayChannels)).sort(sortBy('_id'));

		// channels
		for (const channel of channels) {
			const idPath	= channel._id.split('.');					// [ 'shelly', '0', 'SHDM-2#94B97E16BE61#1',	'lights' ]
			const name	= channel.common.name.toString();				// [ 'shelly', '0', 'SHPLG-S#6A0761#1',			'Relay0' ]

			// accCategory, srvType, characteristics
			let accCategory								= '';			//accCatIds[expose.type]
			let srvType									= '';
			const characteristics: SrvCharacteristic[]	= [];

			// Relay
			if (idPath[3].startsWith('Relay')) {
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
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_shelly()', `created ${idPath[3]}`, channel._id, channel.common.name));

				// name
				characteristics.push({
					'name': 'Name', 'inOutFunction': 'const', 'inOutParameters': name
				});

				// accConfig
				const accConfig: AccConfig = {
					'configType':		'customdevice',
					'enabled':			true,
					'groupString':		srcInstId,				// used by adapter only
					'name':				name,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'category':			accCategory,
					'manufacturer':		'shelly',				// visible within iOS home app
					'serial':			idPath[2],				// visible within iOS home app
					'services':			[],
				};
				accConfigs.push(accConfig);

				// accService
				const accService: AccService = {
					'type': srvType, 'subType': '', 'name': name, 'characteristics':	characteristics
				};
				accConfig.services.push(accService);
			}
		}

		return accConfigs;
	}

	/**
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 */
	private async create_switchboard(srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
		const accConfigs: AccConfig[] = [];

		const pinObjs = await this.getForeignObjectsAsync(`${srcInstId}.pin.*`, 'state') || {};
		for (const pinObj of Object.values(pinObjs).sort(sortBy('_id'))) {
			const objId		= pinObj._id;									//   '0_userdata.0.pin.tür_tag'
			const idPath	= pinObj._id.split('.');						// [ '0_userdata', '0', 'pin', 'tür_tag' ]
			const objRole	= pinObj.common.role;							// 'value.temperature'
			const objName	= pinObj.common.name.toString();				// 'Haustür'

			// yahka device config
			const accConfig: AccConfig = {
				'configType':		'customdevice',							// buggy: will not show up in iOS
				'name':				objId,									// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
				'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
				'model':			objName,								// visible within iOS home app
				'services':			[],										// default
				'enabled':			true,
				'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
			};

			if (objRole === 'door.lock') {
				accConfig.category	= AccCatId.Door_lock;
				accConfig.services = [
					{
						'type': 'LockMechanism', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName												},
							{ 'name': 'LockTargetState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId,			'conversionFunction': 'invert'	},
							{ 'name': 'LockCurrentState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId+'_status',	'conversionFunction': 'invert'	},
						]
					}
				];

			} else if (objRole === 'garage.opener') {
				accConfig.category	= AccCatId.Door_lock;
				accConfig.services = [
					{
						'type': 'GarageDoorOpener', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName												},
							{ 'name': 'TargetDoorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId,			'conversionFunction': 'invert'	},
							{ 'name': 'CurrentDoorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId+'_status',	'conversionFunction': 'invert'	},
							{ 'name': 'ObstructionDetected','inOutFunction': 'const',					'inOutParameters': false												},
						]
					}
				];

			} else if (objRole === 'switch.light') {
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

			} else if (objRole === 'indicator') {
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

			} else {
				this.log.debug(sprintf('%-30s %-20s %-50s ignored', 'create_switchboard()', objRole, objId));
			}

			if (accConfig.services.length > 0) {
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_switchboard()', objRole, objId, pinObj.common.name));
				accConfigs.push(accConfig);
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
		const group = srcInstId;										// 'danfoss-icon.0'

		// danfoss-icon HousePause
		const housePause = await this.getForeignObjectAsync(`${srcInstId}.House.HousePause`);
		if (housePause) {
			const idPath	= housePause._id.split('.');				// [ 'danfoss-icon', '0', 'House', 'HousePause' ]
			const name		= housePause.common.name.toString();

			const accConfig = {
				'configType':		'customdevice',
				'category':			AccCatId.Switch,
				'name':				housePause._id,						// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		group,								// visible within iOS home app
				'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'services':			[] as AccService[],
				'enabled':			true,
				'groupString':		group								// used by adapter only
			};
			accConfigs.push(accConfig);

			accConfig.services.push({
				'type': 'Switch', 'subType': '', 'name': accConfig.model,
				'characteristics': [
					{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': name				},
					{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': housePause._id	}
				]
			});
		}

		// TargetTemp
		const targetTemps = await this.getForeignObjectsAsync(`${srcInstId}.room-*.TargetTemp`, 'state');
		for (const targetTempObj of Object.values(targetTemps).sort(sortBy('_id'))) {
			this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_danfoss()', `TargetTemp`, targetTempObj._id, targetTempObj.common.name));
			const idPath	= targetTempObj._id.split('.');				// [ 'danfoss-icon', '0', 'room-01', 'TargetTemp' ]
			const idBase	= idPath.slice(0, -1).join('.');			//   'danfoss-icon.0.room-01''
			const name		= targetTempObj.common.name.toString();

			const accConfig = {
				'configType':		'customdevice',
				'category':			AccCatId.Thermostat,
				'name':				targetTempObj._id,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		group,								// visible within iOS home app
				'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'services':			[] as AccService[],
				'enabled':			true,
				'groupString':		group								// used by adapter only
			};
			accConfigs.push(accConfig);

			accConfig.services.push({
				'type': 'Thermostat', 'subType': '', 'name': name,
				'characteristics': [
					{ 'name': 'Name',						'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': name						},
					{ 'name': 'TargetTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.TargetTemp'		},
					{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.RoomTemp'		},
					{ 'name': 'TemperatureDisplayUnits',	'inOutFunction': 'const',					'inOutParameters': '0', 					},
					{ 'name': 'TargetHeatingCoolingState',	'inOutFunction': 'const',					'inOutParameters': '3', 					},
					{ 'name': 'CurrentHeatingCoolingState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.ValveState',
						'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value) ? 1 : 2;', 'toIOBroker': 'return (value == 1);' }
					}		// TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
				]			// CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
			});
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
		const zigbeeDevs = await new Promise<ZigbeeDev[]>((resolve, _reject) => {
			const client = mqtt.connect('mqtt://127.0.0.1:1883');
			client.on('connect', (_pkt: mqtt.IConnackPacket) => {
				client
					.on('message', (_topic: string, payload: Buffer, _pkt: mqtt.IPublishPacket) => {
						resolve(JSON.parse(payload.toString()) as ZigbeeDev[]);
					})
					.subscribe('zigbee2mqtt/bridge/devices');
			});
		});

		// mqttDevs
		const iobDevs = await this.getForeignObjectsAsync(`${srcInstId}.*`, 'device');
		for (const iobDev of Object.values(iobDevs)) {
			const idPath	= iobDev._id.split('.');			// [ 'zigbee2mqtt', '0', '0x680ae2fffe14a2cb' ]
			const ieeeAdr	= idPath.slice(-1)[0];
			const zigbeeDev	= zigbeeDevs.find(dev => (dev.ieee_address === ieeeAdr));
			if (! zigbeeDev) {
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', `skipped iobDev`, iobDev._id, iobDev.common.name));

			} else {
				// accCategory, srvType, characteristics
				let accCategory								= '';			//accCatIds[expose.type]
				let srvType									= '';
				const characteristics: SrvCharacteristic[]	= [];

				const features		= zigbeeDev.definition.exposes.filter(expose => 'name'     in expose);
				const typedFeatures	= zigbeeDev.definition.exposes.filter(expose => 'features' in expose);
				const exposedLight	= typedFeatures.filter(expose => (expose.type === 'light'))[0];

				// Lightbulb
				if (exposedLight) {
					accCategory =  AccCatId.Lightbulb;
					srvType		= 'Lightbulb';
					for (const feature of exposedLight.features) {
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

 				// ContactSensor
				} else if (features.find(feature => (feature.name === 'contact'))) {
					accCategory =  AccCatId.Sensor;
					srvType		= 'ContactSensor';
					for (const feature of features) {
						if (feature.name === 'contact') {
							characteristics.push({
								'name': 'ContactSensorState', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters':	`${iobDev._id}.opened`
							});
						} else if (feature.name === 'battery') {
							characteristics.push({
								'name': 'StatusLowBattery', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`,
								'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
							});
						}
					}

 				// LeakSensor
				} else if (features.find(feature => (feature.name === 'water_leak'))) {
					accCategory =  AccCatId.Sensor;
					srvType		= 'LeakSensor';
					for (const feature of features) {
						if (feature.name === 'water_leak') {
							characteristics.push({
								'name': 'LeakDetected', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters':	`${iobDev._id}.detected`
							});
						} else if (feature.name === 'battery') {
							characteristics.push({
								'name': 'StatusLowBattery', 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${iobDev._id}.battery`,
								'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value < 10);' }
							});
						}
					}

				} else if (typedFeatures.length > 0) {
					this.log.debug(sprintf('%-30s %-20s %-50s %s\n%s', 'create_zigbee2mqtt()', 'skipped features', iobDev._id, zigbeeDev.friendly_name, JSON.stringify(typedFeatures, null, 4)));

				} else {
					this.log.debug(sprintf('%-30s %-20s %-50s %s',		'create_zigbee2mqtt()', `skipped ${zigbeeDev.type}`, iobDev._id, zigbeeDev.friendly_name));
					//this.log.debug(sprintf('%-30s %-20s %-50s %s\n%s',	'create_zigbee2mqtt()', `skipped ${zigbeeDev.type}`, iobDev._id, zigbeeDev.friendly_name, JSON.stringify(zigbeeDev, null, 4)));
				}

				// add devConfig
				if (accCategory  &&  srvType) {
					this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', `created ${zigbeeDev.type}`, iobDev._id, zigbeeDev.friendly_name));
					const grpName	= idPath.slice(0, 2).join('.');
					const devName	= `${grpName}.${zigbeeDev.friendly_name}`;

					// name
					characteristics.push({
						'name': 'Name', 'inOutFunction': 'const', 'inOutParameters': zigbeeDev.friendly_name
					});

					// accConfig
					const accConfig: AccConfig = {
						'configType':		'customdevice',
						'enabled':			true,
						'groupString':		grpName,				// used by adapter only
						'name':				devName,				// NOTE: yahka adapter uses 'name' to build homekit UUID!
						'category':			accCategory,
						'manufacturer':		zigbeeDev.definition.vendor,									// visible within iOS home app
						'serial':			zigbeeDev.ieee_address,											// visible within iOS home app
						'model':			`${zigbeeDev.model_id} (${zigbeeDev.definition.model})`,		// visible within iOS home app
						'firmware':			zigbeeDev.software_build_id,									// visible within iOS home app
						'services':			[],
					};
					accConfigs.push(accConfig);

					// accService
					const accService: AccService = {
						'type': srvType, 'subType': '', 'name': zigbeeDev.friendly_name, 'characteristics':	characteristics
					};
					accConfig.services.push(accService);
				}
			}
		}

		//this.log.debug(sprintf('%-30s %-20s %-50s\n%s', 'create_zigbee2mqtt()', 'devConfigs', '', JSON.stringify(devConfigs, null, 4)));
		return accConfigs;
	}


	/**
	 * Is called when adapter shuts down - callback has to be called under any circumstances!
	 */
	private onUnload(callback: () => void): void {
		try {
		} finally {
			callback();
		}
	}

	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	// createYahkaConfig(srcInstId, yahkaDstApt)
	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	async createYahkaConfig(srcInstId: string, yahkaDstApt: ioBroker.Object): Promise<void> {		// e.g.: [ "fritzdect.0", ... ], "system.adapter.yahka.0"
		const yahkaAptId = yahkaDstApt._id;
		this.log.info(sprintf('%-31s %-20s %-50s', 'createYahkaConfig()', 'target', yahkaAptId));
		//this.log.info(sprintf('%-31s %-20s\n%s', 'createYahkaConfig()', yahkaAptId, JSON.stringify(srcInsts, null, 4)));

		// collect source state objects
		const stateObjs  = await this.getForeignObjectsAsync(`${srcInstId}.*`, 'state')  ||  {};
		const statesArr  = Object.values(stateObjs);
		//this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', 'statesArr', '', '\n'+JSON.stringify(statesArr, null, 4)));

		statesArr.sort((obj1, obj2) => (obj1._id > obj2._id) ? +1 : ((obj1._id < obj2._id) ? -1 : 0));

		// get yahkaNewDevs and enable/disable yahka configs
		const yahkaNewDevs = await this.createYahkaDevs(statesArr);
		const yahkaOldDevs = yahkaDstApt['native']['bridge']['devices']	as {name: string, enabled: boolean}[];
		//this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', dstInst, 'yahkaOldDevs', '\n'+JSON.stringify(yahkaOldDevs, null, 4)));
		//this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', dstInst, 'yahkaNewDevs', '\n'+JSON.stringify(yahkaNewDevs, null, 4)));

		// get 'enabled' state from oldDev		-		yahka adapter uses 'name' to build homekit UUID
		for (const yahkaNewDev of  yahkaNewDevs) {
			const  yahkaOldDev  =  yahkaOldDevs.find(oldDev => (oldDev.name === yahkaNewDev.name));
			yahkaNewDev.enabled = (yahkaOldDev) ? yahkaOldDev.enabled : true;
		}

		// keep custom yahka device configs		-		yahka adapter uses 'name' to build homekit UUID
		let yahkaChanged = false;
		for (const yahkaOldDev of yahkaOldDevs) {
			const keep = ! yahkaNewDevs.some((newDev) => (newDev.name === yahkaOldDev.name));
			if (keep) {
				this.log.warn(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', 'keeping', yahkaOldDev.name, ''));
				yahkaOldDev.enabled = false;
				yahkaNewDevs.push();
			}
		}

		// yahkaChanged?						-		yahka adapter uses 'name' to build homekit UUID
		yahkaOldDevs.sort(sortBy('name'));
		yahkaNewDevs.sort(sortBy('name'));
		const diff = objDiff(yahkaOldDevs, yahkaNewDevs, 'yahkaDevs');
		yahkaChanged = yahkaChanged  ||  (Object.values(diff).length > 0);

		// debug
		if (Object.values(diff).length > 0) {
			this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', yahkaAptId, 'diff', '\n'+JSON.stringify(diff, null, 4)));
		}

		// save
		if (yahkaChanged) {
			this.log.info(sprintf('%-31s %-20s %-50s %s', 'createYahkaConfig()', yahkaAptId, 'saving yahka devices ...', ''));
			//	await this.extendForeignObjectAsync(dstInst, { 'native': { 'bridge': { 'devices': yahkaNewDevs } } });
			yahkaDstApt['native']['bridge']['devices'] = yahkaNewDevs;
			await this.setForeignObjectAsync(yahkaAptId, yahkaDstApt);
		}
	}

	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~
	// createYahkaDevs(iobSrcObjs)
	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~
	async createYahkaDevs(iobSrcObjs: ioBroker.StateObject[]): Promise<{name: string, enabled: boolean}[]> {		// iobSrcObjs: array of iobroker objects
		this.log.info(sprintf('%-31s %-20s %-50s', 'createYahkaDevs()', '#'+iobSrcObjs.length, '...'));
		const yahkaNewDevs = [];

		if (! Array.isArray(iobSrcObjs)) {
			this.log.warn(sprintf('%-31s %-20s %-50s %s', 'createYahkaDevs()', 'iobSrcObjs is not an arrray', '', ''));

		} else {
			// process array of iobSrcObjs
			for (const iobSrcObj of iobSrcObjs) {
				const yahkaNewDev = await this.createYahkaDev(iobSrcObjs, iobSrcObj);
				if  ( yahkaNewDev ) {
					yahkaNewDevs.push(yahkaNewDev);
				}
			}
		}

		this.log.info(sprintf('%-31s %-20s %-50s', 'createYahkaDevs()', '#'+iobSrcObjs.length, 'done.'));
		return yahkaNewDevs;
	}



	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	// createYahkaDev(iobSrcObjs, iobSrcObj)
	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	async createYahkaDev(iobSrcObjs: ioBroker.StateObject[], iobSrcObj: ioBroker.StateObject): Promise<AccConfig | null > {		// iobObj: iobroker object
		const objRole		= iobSrcObj.common.role;					// 'value.temperature'
		const objName		= iobSrcObj.common.name as string;			// 'OG.Küche.targettemp'
		const objValType	= iobSrcObj.common.type;					// 'string', 'boolean', 'number', ...
		const objId			= iobSrcObj._id;							// 'fritzdect.0.DECT_099950049420.tsoll'
		const idPath		= objId.split('.');							// [ 'fritzdect', '0', 'DECT_099950049420', 'tsoll' ]
		const idBase		= idPath.slice(0, -1).join('.');			// 'fritzdect.0.DECT_099950049420'
		const idLeaf		= idPath.slice(   -1)[0];					//                               'tsoll'
		//this.log.info(sprintf('%-31s %-20s %-50s', 'createYahkaDev()', objRole, objId));

		// yahka device config
		const devCfg: AccConfig = {
			'configType':		'customdevice',							// buggy: will not show up in iOS
			'name':				objId,									// NOTE: yahka adapter uses 'name' to build homekit UUID!
			'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
			'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
			'model':			objName,								// visible within iOS home app
			'services':			[],										// default
			'enabled':			true,
			'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
		};


		// ~~~~~~~~~~~~~~~~~~
		// danfoss-icon state
		// ~~~~~~~~~~~~~~~~~~
		if (idPath[0] === 'danfoss-icon') {
			// danfoss-icon HousePause
			// ~~~~~~~~~~~~~~~~~~~~~~~
			if (idLeaf === 'HousePause') {															// objId: danfoss-icon.0.House.HousePause
				devCfg.firmware	= '';
				devCfg.category = AccCatId.Switch;
				devCfg.services = [
					{
						'type': 'Switch', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': objId }
						]
					}
				];

			// danfoss-icon room thermostat
			// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			} else if (idLeaf === 'TargetTemp') {
				const nameId	= `${idBase}.RoomName`;												// 'danfoss-icon.0.room-01.RoomName'
				const nameStr	= (await this.getForeignStateAsync(nameId) || {}).val || 'n/a';		// 'Wohnzimmer'
				devCfg.category	= AccCatId.Thermostat;
				devCfg.services = [
					{
						'type': 'Thermostat', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',						'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': nameId					},
							{ 'name': 'TargetTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.TargetTemp'		},
							{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.RoomTemp'		},
							{ 'name': 'TemperatureDisplayUnits',	'inOutFunction': 'const',					'inOutParameters': '0', 					},
							{ 'name': 'TargetHeatingCoolingState',	'inOutFunction': 'const',					'inOutParameters': '3', 					},
							{ 'name': 'CurrentHeatingCoolingState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': idBase+'.ValveState',
								'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value) ? 1 : 2;', 'toIOBroker': 'return (value == 1);' }
							}		// TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
						]			// CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
					}
				];
			}

		// ~~~~~~~~~~~~~~
		// openweathermap
		// ~~~~~~~~~~~~~~																// openweathermap.0.forecast.current.temperature
		} else if (idPath[0] === 'openweathermap'  &&  idPath[3] === 'current') {		// openweathermap.0.forecast.current.humidity
			const nameStr	= objName.split('.').join(' ');								// 'M41 Garten humidity'

			// openweathermap current temperature
			// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			if (idLeaf === 'temperature') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'TemperatureSensor', 'subType': '', 'name': nameStr,
						'characteristics': [
							{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
							{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	},
						]
					}
				];

			// openweathermap current humidity
			// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			} else if (idLeaf === 'humidity') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'HumiditySensor', 'subType': '', 'name': nameStr,
						'characteristics': [
							{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
							{ 'name': 'CurrentRelativeHumidity',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	},
						]
					}
				];
			}

		// ~~~~~~~~~~~~
		// shelly state
		// ~~~~~~~~~~~~
		} else if (idPath[0] === 'shelly') {
			const nameId	= `${idBase}.ChannelName`;
			const nameStr	=    (await this.getForeignStateAsync(nameId) || {}).val || 'n/a';			// 'Terrassenlampen'
			devCfg.firmware	= ''+(await this.getForeignStateAsync(idPath.slice(0,-2).join('.') + '.version') || {val:'n/a'}).val;

			// shelly dimmer
			if (idLeaf === 'brightness') {										// objId: 'shelly.0.SHDM-2#94B97E16BE61#1.lights.brightness'
				devCfg.category = AccCatId.Lightbulb;
				devCfg.services = [
					{
						'type': 'Lightbulb', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': nameId					},
							{ 'name': 'On',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.Switch`		},
							{ 'name': 'Brightness',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.brightness`	},
						]
					}
				];

			// shelly switch
			} else if (idLeaf === 'Switch'  &&  idPath[3].startsWith('Relay')) {		// objId: 'shelly.0.SHPLG-S#6A0761#1.Relay0.Switch'
				devCfg.firmware	= ''+(await this.getForeignStateAsync(idPath.slice(0,-2).join('.') + '.version') || {val:'n/a'}).val;
				devCfg.category = AccCatId.Switch;
				devCfg.services = [
					{
						'type': 'Switch', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': nameId	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];
			}

		// ~~~~~~~~~~~~
		// sonoff state
		// ~~~~~~~~~~~~
		} else if (idPath[0] === 'sonoff'  &&  [ 'POWER1', 'POWER2', 'SI7021_Temperature', 'SI7021_Humidity' ].indexOf(idLeaf) >= 0) {
			// Sonoff Device Name
			const nameStr	=    (await this.getForeignStateAsync(`${idBase}.DeviceName`		) || {}).val  ||  'n/a';  // 'Keller Sensor'
			devCfg.firmware	= ''+(await this.getForeignStateAsync(`${idBase}.INFO.Info1_Version`) || {}).val  ||  'n/a';  // '12.1.1(tasmota)'

			// sonoff POWER1, POWER2
			// ~~~~~~~~~~~~~~~~~~~~~
			if ([ 'POWER1', 'POWER2' ].indexOf(idLeaf) >= 0) {
				devCfg.category = AccCatId.Switch;
				devCfg.services = [
					{
						'type': 'Switch', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.DeviceName`	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId					}
						]
					}
				];

			// sonoff state value.temperature
			// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			} else if (idLeaf === 'SI7021_Temperature') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'TemperatureSensor', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',						'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.DeviceName`	},
							{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId					},
						]
					}
				];

			// sonoff state value.humidity
			// ~~~~~~~~~~~~~~~~~~~~~~~~~~~
			} else if (idLeaf === 'SI7021_Humidity') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'HumiditySensor', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',						'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.DeviceName`	},
							{ 'name': 'CurrentRelativeHumidity',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId					},
						]
					}
				];
			}

		// ~~~~~~~~~~~~~~~~~~~
		// kernel state switch
		// ~~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'kernel'  &&  objRole  === 'switch') {
			devCfg.category = AccCatId.Switch;
			devCfg.services = [
				{
					'type': 'Switch', 'subType': '', 'name': objName,					// objName:		e.g. 'Albi da'
					'characteristics': [
						{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': objName	},
						{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
					]
				}
			];

		// ~~~~~~~~~~~~~~~~~~~~~~~
		// kernel state sensor.lux
		// ~~~~~~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'kernel'  &&  objRole === 'sensor.lux') {
			devCfg.category = AccCatId.Sensor;
			devCfg.services = [
				{	// LightSensor
					'type': 'LightSensor', 'subType': '', 'name': objName,		// objName:		e.g. ''
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': objName	},
						{ 'name': 'CurrentAmbientLightLevel',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
					]
				}
			];

		// ~~~~~~~~~
		// fritzdect
		// ~~~~~~~~~
		} else if (idPath[0] === 'fritzdect'  &&  [ 'tsoll', 'tist', 'celsius' ].includes(idLeaf)) {					// 'fritzdect.0.......'
			const nameStr	=    (await this.getForeignStateAsync(`${idBase}.name`			) || {}).val ||	'n/a';		// 'Küche OG'
			devCfg.model	= ''+(await this.getForeignStateAsync(`${idBase}.productname`	) || {}).val ||	'n/a';		// 'FRITZ!DECT 301'
			devCfg.firmware	= ''+(await this.getForeignStateAsync(`${idBase}.fwversion`		) || {}).val ||	'n/a';		// '05.02'

			// FRITZ!DECT 301
			if (devCfg.model === 'FRITZ!DECT 301') {

				// FRITZ!DECT 301 - Thermostat Device
				if (idLeaf === 'tsoll') {
					devCfg.category	= AccCatId.Thermostat;
					devCfg.services = [
						{
							'type': 'Thermostat', 'subType': '', 'name': ''+nameStr,
							'characteristics': [
								{ 'name': 'TemperatureDisplayUnits',	'inOutFunction': 'const',					'inOutParameters': '0'								},
								{ 'name': 'Name',						'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.name`					},
								{ 'name': 'TargetTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.tsoll`				},
								{ 'name': 'CurrentTemperature',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.celsius` 				},
								{ 'name': 'TargetHeatingCoolingState',	'inOutFunction': 'const',					'inOutParameters': '3', 							},
								{ 'name': 'CurrentHeatingCoolingState', 'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.heatingCoolingState`	},
							]		// TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
						},			// CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
						{
							'type': 'BatteryService', 'subType': '', 'name': ''+nameStr,
							'characteristics': [
								{ 'name': 'ChargingState',				'inOutFunction': 'const',					'inOutParameters': '2'						},
								{ 'name': 'BatteryLevel',				'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.battery`		},
								//{ 'name': 'StatusLowBattery',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.batterylow`	},
								{ 'name': 'StatusLowBattery',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.battery`,
									'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value <= 20);', 'toIOBroker': 'return false;' }
								}	// fritzdect battery (level) [%]
							]
						}
					];

				// FRITZ!DECT 301 - Thermostat Temperature Sensor
				} else if (idLeaf === 'tist') {
					devCfg.category	= AccCatId.Thermostat;
					devCfg.services = [
						{
							'type': 'TemperatureSensor', 'subType': '', 'name': ''+nameStr,
							'characteristics': [
								{ 'name': 'CurrentTemperature',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.tist`	},
							]
						}
					];
				}

			// FRITZ!DECT 200 Switch
			} else if (devCfg.model === 'FRITZ!DECT 200'  &&  idLeaf === 'celsius') {
				devCfg.category = AccCatId.Switch;
				devCfg.services = [
					{
						'type': 'Switch', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.name`		},
							{ 'name': 'On',					'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.state`	}
						]
					},
					{
						'type': 'TemperatureSensor', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'CurrentTemperature',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.celsius`	},
						]
					}
				];

			// FRITZ!DECT Repeater 100
			} else if (devCfg.model === 'FRITZ!DECT Repeater 100'  &&  idLeaf === 'celsius') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'TemperatureSensor', 'subType': '', 'name': ''+nameStr,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${idBase}.name`		},
							{ 'name': 'CurrentTemperature',	'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': `${idBase}.celsius`	},
						]
					}
				];

			} else {
				this.log.warn(sprintf('%-15s %-25s %-45s %s', 'ConfigureYahka', 'createYahkaDev()', objId, 'not implemented yet'));
			}

		// ~~~~~~~~~~~~~~~~~~~~~~~~~~
		// tr064 boolean state/button
		// ~~~~~~~~~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'tr-064'  &&  idPath[2] == 'states'  &&  (objRole === 'state'  ||  objRole === 'button')) {
			if (objValType === 'boolean'  &&  idLeaf !== 'wlan') {						// idPath: e.g.:	'tr-064.0.states.wps'
				devCfg.category	= AccCatId.Switch;
				devCfg.services = [
					{
						'type': 'Switch', 'subType': '', 'name': devCfg.model,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': devCfg.model	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
						]
					}
				];
			}

		// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
		// switchboard-io boolean switch / contact sensor
		// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === '0_userdata'  &&  idPath[2] === 'pin') {
			if (objRole === 'door.lock') {
				devCfg.category	= AccCatId.Door_lock;
				devCfg.services = [
					{
						'type': 'LockMechanism', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName												},
							{ 'name': 'LockTargetState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId,			'conversionFunction': 'invert'	},
							{ 'name': 'LockCurrentState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId+'_status',	'conversionFunction': 'invert'	},
						]
					}
				];

			} else if (objRole === 'garage.opener') {
				devCfg.category	= AccCatId.Door_lock;
				devCfg.services = [
					{
						'type': 'GarageDoorOpener', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName												},
							{ 'name': 'TargetDoorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId,			'conversionFunction': 'invert'	},
							{ 'name': 'CurrentDoorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId+'_status',	'conversionFunction': 'invert'	},
							{ 'name': 'ObstructionDetected','inOutFunction': 'const',					'inOutParameters': false												},
						]
					}
				];

			} else if (objRole === 'switch.light') {
				devCfg.category = AccCatId.Switch;
				devCfg.services = [
					{
						'type': 'Switch', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			} else if (objRole === 'switch.fan') {
				devCfg.category = AccCatId.Fan;
				devCfg.services = [
					{
						'type': 'Fan', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			} else if (objRole === 'sensor.leak') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'LeakSensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',			'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'LeakDetected',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			} else if (objRole === 'sensor.motion') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'MotionSensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'MotionDetected',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			} else if (objRole === 'sensor.occupancy') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'OccupancySensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'OccupancyDetected',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			} else if (objRole === 'indicator') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': 'ContactSensor', 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': 'ContactSensorState',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	},
						]
					}
				];

			} else {
				this.log.debug(sprintf('%-30s %-20s %s (role "%s" not implemtented)', 'createYahkaDev()', 'ignored', objId, objRole));
			}


		// ~~~~~~~~~~~~~~~~~~~~~~~~~~
		// tr064 devices active state
		// ~~~~~~~~~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'tr-064'  &&  idPath[2] == 'devices'  &&  idLeaf == 'active'  &&  objRole === 'state') {
			const nameStr	= idPath[idPath.length - 2];					// devCfg.name:	e.g.:	'iPhone-Albi'
			devCfg.category	= AccCatId.Sensor;
			devCfg.services = [
				{
					'type': 'OccupancySensor', 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': 'OccupancyDetected',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
				}
			];
			/*
					'type': "ContactSensor", 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': "ContactSensorState",			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
					'type': "OccupancySensor", 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': "OccupancyDetected",			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
					'type': "Switch", 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': 'On',							'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
					'type': "Doorbell", 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': "ProgrammableSwitchEvent",	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
					'type': "OccupancySensor", 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': "OccupancyDetected",			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
					'type': "MotionSensor", 'subType': '', 'name': nameStr,
					'characteristics': [
						{ 'name': 'Name',						'inOutFunction': 'const',					'inOutParameters': nameStr	},
						{ 'name': "MotionDetected",				'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId		}
					]
			*/

		/*
		// ~~~~~~~~~
		// hue level
		// ~~~~~~~~~
		} else if (idPath[0] === 'hue'  &&  idLeaf === 'level') {						// hue.0_P17.Philips_hue.Fensterlampe.level
			const channelObj = await this.getForeignObjectAsync(idBase);				// hue.0_P17.Philips_hue.Fensterlampe

			if (channelObj.common.role !== 'Room') {
				const hueRole	= channelObj['common'].role.replace(/\./g, '_');		// light_color
				const hueId		= channelObj['native'].id;								// 4
				const nameStr	= channelObj['native'].name;							// Fensterlampe
				idPath[3]		= hueRole + '_' + hueId;
				devCfg.model	= idPath.slice(2, 4).join('.');							// Philips_hue.Fensterlampe

				// hue level
				// ~~~~~~~~~
				devCfg.category = AccCatId.Lightbulb;
				devCfg.services = [
					{
						'type': 'Lightbulb', 'subType': '', 'name': nameStr,
						'characteristics': [
							{ 'name': 'Name',		'inOutFunction': 'const',						'inOutParameters': nameStr			},
							{ 'name': 'On',			'inOutFunction': 'ioBroker.State.OnlyACK',		'inOutParameters': idBase+'.on'		},
							{ 'name': 'Brightness',	'inOutFunction': 'ioBroker.State.OnlyACK',		'inOutParameters': idBase+'.level'	},
						]
					}
				];
			}

		// ~~~~~~~~~~~~~~~~~~~~~~~~~
		// hue-extended lights level
		// ~~~~~~~~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'hue-extended'  &&  idPath[2] === 'lights'  &&  idPath[4] === 'action'  &&  idLeaf === 'level') {				// hue.0_P17.Philips_hue.Fensterlampe.level
			this.log.warn(sprintf('%-31s %-20s %-50s', 'createYahkaDev()', 'not implemented', objId));

		// ~~~~~~~~~~~~~~~~~~
		// tradfri brightness		-		NOTE: not needed because tradfri exposes it's own homekit bridge!
		// ~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'tradfri'  &&  idLeaf === 'brightness') {						// tradfri.0.L-65551.lightbulb.brightness
			const deviceObj = await this.getForeignObjectAsync(idPath.slice(0, 3).join('.'));	// tradfri.0.L-65551
			this.log.info(sprintf('%-31s %-20s %-50s %s deviceObj %s', 'createYahkaDev()', objRole, idBase, idLeaf, JSON.stringify(deviceObj, null, 4)));

			if (deviceObj.native.type === 'lightbulb') {
				const nameStr		= deviceObj.common.name;									// Fensterlampe
				devCfg.manufacturer	= deviceObj.native.manufacturer;							// IKEA of Sweden
				devCfg.model		= deviceObj.native.modelNumber;								// TRADFRI bulb E14 WS 470lm
				devCfg.firmware		= deviceObj.native.firmwareVersion;							// 2.3.08

				// hue level
				// ~~~~~~~~~
				devCfg.category = AccCatId.Lightbulb;
				devCfg.services = [
					{
						'type': 'Lightbulb', 'subType': '', 'name': nameStr,
						'characteristics': [
							{ 'name': 'Name',		'inOutFunction': 'const',						'inOutParameters': nameStr				},
							{ 'name': 'On',			'inOutFunction': 'ioBroker.State.OnlyACK',		'inOutParameters': `${idBase}.state`		},
							{ 'name': 'Brightness',	'inOutFunction': 'ioBroker.State.OnlyACK',		'inOutParameters': `${idBase}.brightness`	},
						]
					}
				];
			}

		// ~~~~~
		// zwave
		// ~~~~~
		} else if (idPath[0] === 'zwave') {
			const nodeId   = idPath.slice(0, 3).join('.');					// zwave.0.NODE3
			const switchId = nodeId + '.SWITCH_BINARY.Switch_1';			// zwave.0.NODE3.SWITCH_BINARY.Switch_1
			const levelId  = nodeId + '.SWITCH_MULTILEVEL.Level_1';			// zwave.0.NODE7.SWITCH_MULTILEVEL.Level_1
			devCfg.model = idPath.slice(2, 4).join('.');					//         NODE7.SWITCH_MULTILEVEL

			if (objId === switchId  ||  objId === levelId) {
				//const switchObj = (objId === switchId) ? iobObj :	await this.getForeignObjectAsync(switchId);
				const nodeObj   =									await this.getForeignObjectAsync(nodeId);
				const devName	= nodeObj.common.name;

				// product "FGWPE/F Wall Plug",							producttype "0x0600",  productid "0x1000",  type "Binary Switch"
				// product "FGWPE/F Wall Plug",							producttype "0x0600",  productid "0x1000",  type "Binary Power Switch"
				if (objId === switchId  &&  nodeObj['native'].productid === '0x1000') {
					devCfg.category = AccCatId.Switch;
					devCfg.services = [
						{
							'type': 'Switch', 'subType': '', 'name': nameStr,
							'characteristics': [
								{ 'name': 'Name',	'inOutFunction': 'const',					'inOutParameters': devName	},
								{ 'name': 'On',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': switchId	},
							]
						}
					];

				// product "FGD211 Universal Dimmer 500W",				producttype "0x0100",  productid "0x100a",  type "Multilevel Power Switch"
				} else if (objId === levelId  &&  nodeObj['native'].type === 'Multilevel Power Switch') {
					devCfg.category = AccCatId.Lightbulb;
					devCfg.services = [
						{
							'type': 'Lightbulb', 'subType': '', 'name': nameStr,
							'characteristics': [
								{ 'name': 'Name',		'inOutFunction': 'const',					'inOutParameters': devName			},
								{ 'name': 'Brightness',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': levelId,
									'conversionFunction':	'script',
									'conversionParameters': {
										'toHomeKit':		'return Math.min(100, Math.round(100 * value/ 99));',
										'toIOBroker':		'return Math.min( 99, Math.round( 99 * value/100));',
									}
									//"conversionFunction": "scaleInt",
									//"conversionParameters": JSON.stringify({
									//	'homekit.max':		100,
									//	'iobroker.max':		99
									//})
								}
							]
						}
					];
					//	const levelObj  = (objId === levelId ) ? iobObj 	: await this.getForeignObjectAsync(levelId);
					const switchObj = (objId === switchId) ? iobSrcObj	: await this.getForeignObjectAsync(switchId);
					if (switchObj) {
						devCfg.services[0].characteristics.push({
							'name':					'On',
							'inOutFunction':		'ioBroker.State.OnlyACK',
							'inOutParameters':		switchId
						});
					} else {
						devCfg.services[0].characteristics.push({
							'name':					'On',
							'inOutFunction':		'ioBroker.State.OnlyACK',
							'inOutParameters':		levelId,
							'conversionFunction':	'script',
							'conversionParameters': {
								'toHomeKit':		'return (value) ? true : false;',
								'toIOBroker':		'return (value) ?   99 :     0;'
							}
						});
					}

				// product "FGRM222 Roller Shutter Controller 2",		producttype "0x0301",  productid "0x1001",  type "Motor Control Class B"
				} else if (objId === levelId  &&  nodeObj['native'].type === 'Motor Control Class B') {
					devCfg.category = AccCatId.Window_covering;
					devCfg.services = [
						{
							'type': 'WindowCovering', 'subType': '', 'name': nameStr,
							'characteristics': [
								{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': devName					},
								{ 'name': 'TargetPosition',		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': levelId,
									'conversionFunction': 'scaleInt', 'conversionParameters': '{ "homekit.max": 100, "iobroker.max": 99 }'
								},
								{ 'name': 'CurrentPosition',	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': levelId,
									'conversionFunction': 'scaleInt', 'conversionParameters': '{ "homekit.max": 100, "iobroker.max": 99 }'
								},
								{ 'name': 'PositionState',		'inOutFunction': 'const',			'inOutParameters': '2'						},
							]
						}
					];
				}
			}
		*/
		}

		// enable all characteristics
		for (const srv of devCfg.services) {
			for (const chr of srv.characteristics) {
				chr.enabled = true;
			}
		}

		if (devCfg.services.length > 0) {
			this.log.info(sprintf('%-31s %-20s %-50s', 'createYahkaDev()', 'created', devCfg.name));
		}

		return (devCfg.services.length > 0) ? devCfg : null;
	}
}


// ~~~~~~~~~~~
// sortBy(key)
// ~~~~~~~~~~~
function sortBy(key: string) {
	return (a: {[index: string]: any}, b: {[index: string]: any}) => (a[key] > b[key]) ? +1 : ((a[key] < b[key]) ? -1 : 0);
}


// ~~~~~~~~~~~~~~~~~~~~~~~
// objDiff(oldObj, newObj)
// ~~~~~~~~~~~~~~~~~~~~~~~
interface DiffObj {
	[index: string]: {
		old?:	object,
		new?:	object,
	}
}
function objDiff(oldObj: {[index: string]: any}, newObj: {[index: string]: any}, path = '', diff: DiffObj = {}): object {		// check if newObj values are same in oldObj
	//adapter.log.info(sprintf('%-30s %-20s %-50s %s', 'objDiff()', 'path', path, ''));
	if (oldObj === undefined) {
		diff[path] = { 'new': newObj };

	} else if (newObj === undefined) {
		diff[path] = { 'old': oldObj };

	} else if (Array.isArray(newObj)) {
		newObj.forEach((val, idx) => {
			objDiff(oldObj[idx], newObj[idx], path+'['+idx+']', diff);
		});

	} else if (newObj instanceof Object) {
		Object.keys(newObj).forEach((key) => {				// loop trough newObj members
			objDiff(oldObj[key], newObj[key], path+'.'+key, diff);
		});

	} else if (! Object.is(oldObj, newObj)) {
		diff[path] = { 'old': oldObj, 'new': newObj };
	}

	return diff;
}



if (require.main !== module) {
	// Export the constructor in compact mode
	module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new YahkaConfig(options);
} else {
	// otherwise start the instance directly
	(() => new YahkaConfig())();
}
