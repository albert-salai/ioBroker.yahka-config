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
	name:					string,
	category:				string,
	services:				AccService[],
	groupString:			string
	configType?:			string,
	manufacturer?:			string,
	model?:					string,
	serial?:				string,
	firmware?:				string,
	enabled?:				boolean,
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
		this.log.info(sprintf('%-31s %-20s %-50s', 'onReady()', 'mapping', '\n'+JSON.stringify(mapping, null, 4)));

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
						'configType':		'customdevice',
						'manufacturer':		'n/a',				// visible within iOS home app
						'model':			'n/a',				// visible within iOS home app
						'serial':			'n/a',				// visible within iOS home app
						'firmware':			'n/a',				// visible within iOS home app
						'enabled':			true,
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
						yahkaNewDevs.push(yahkaOldDev);
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
					'category':			AccCatId.Switch,
					'name':				state._id,								// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
					'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
					'model':			state.common.name.toString(),			// visible within iOS home app
					'services':			[] as AccService[],
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
				'category':			'',
				'name':				objId,									// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
				'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
				'model':			objName,								// visible within iOS home app
				'services':			[],										// default
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
				'category':			AccCatId.Switch,
				'name':				housePause._id,						// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		group,								// visible within iOS home app
				'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'services':			[] as AccService[],
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
				'category':			AccCatId.Thermostat,
				'name':				targetTempObj._id,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		group,								// visible within iOS home app
				'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'services':			[] as AccService[],
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
				//this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', `zigbeeDev`, iobDev._id, JSON.stringify(zigbeeDev, null, 4)));

				// accCategory, srvType, characteristics
				let accCategory								= '';			//accCatIds[expose.type]
				let srvType									= '';
				const characteristics: SrvCharacteristic[]	= [];

				const typedFeatures	= zigbeeDev.definition.exposes.filter(expose => 'features' in expose);
				const features		= zigbeeDev.definition.exposes.filter(expose => 'name'     in expose);
				const featureNames	= features.map(feature => feature.name);
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
				} else if (featureNames.includes('contact')) {
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
				} else if (featureNames.includes('water_leak')) {
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

				// enable history
				//this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', `featureNames`, iobDev._id, JSON.stringify(featureNames, null, 4)));
				for (const featureName of [ 'linkquality', 'opened', 'detected', 'battery', 'battery_low', 'device_temperature', 'voltage' ]) {
					if (featureNames.includes(featureName)) {
						const stateName = (featureName === 'linkquality' ? 'link_quality' : featureName)
						await this.enableHistory(`${iobDev._id}.${stateName}`);
					}
				}
				await this.enableHistory(`${iobDev._id}.available`);

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
						'groupString':		grpName,				// used by adapter only
						'name':				devName,				// NOTE: yahka adapter uses 'name' to build homekit UUID!
						'category':			accCategory,
						'manufacturer':		zigbeeDev.definition.vendor,									// visible within iOS home app
						'serial':			zigbeeDev.ieee_address,											// visible within iOS home app
						'model':			`${zigbeeDev.model_id} (${zigbeeDev.definition.model})`,		// visible within iOS home app
						'firmware':			zigbeeDev.software_build_id  ||  'n/a',							// visible within iOS home app
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
	 *
	 * @param srcInstId
	 * @param _yahkaDstApt
	 * @returns
	 */
	private async create_fritzdect(_srcInstId: string, _yahkaDstApt: ioBroker.Object): Promise<AccConfig[]> {
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
	 * @param stateId
	 */
	private async enableHistory(stateId: string): Promise<void> {
		if (this.historyId) {
			const stateObj = await this.getForeignObjectAsync(stateId);
			if (stateObj?.type === 'state') {
				const {type, common, native } = stateObj;
				common.custom = common.custom  ||  {};
				common.custom[this.historyId] = Object.assign({
					// defaults
					'enabled':					true,
					'changesRelogInterval':		0,
					'retention':				0,
					'changesOnly':				false,
				}, common.custom[this.historyId], {
					// overrides
					'changesOnly':				false,
				});

				//this.log.debug(sprintf('%-30s %-20s %-50s %s', 'enableHistory()', 'common', stateId, JSON.stringify(common, null, 4)));
				await this.setForeignObjectAsync(stateId, { type, common, native });

			} else {
				this.log.warn(sprintf('%-30s %-20s %-50s', 'enableHistory()', 'missing', stateId));
			}
		}
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
