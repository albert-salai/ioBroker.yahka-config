import * as utils			from '@iobroker/adapter-core';
import YahkaIoPkgJson		from 'iobroker.yahka/io-package.json';
import { sprintf }			from 'sprintf-js';

//
import { EventEmitter } from 'node:events';
declare global {
	// eslint-disable-next-line @typescript-eslint/no-namespace
	namespace ioBroker {
		export interface Adapter {
			emit:		typeof EventEmitter.prototype.emit;
		}
	}
}


// DevCharacteristic
interface DevCharacteristic {
	name:					string,
	enabled?:				boolean,
	inOutFunction:			string,
	inOutParameters:		string | boolean | number,
	conversionFunction?:	string,
	conversionParameters?:	{ toHomeKit: string, toIOBroker: string },
}

// DevService
interface DevService {
	type:					string,
	subType:				string,
	name:					string,
	characteristics:		DevCharacteristic[]
}

// DevConfig
interface DevConfig {
	configType:				string,
	category:				string,
	name:					string,
	manufacturer:			string,
	serial:					string,
	model:					string,
	firmware:				string,
	services:				DevService[],
	enabled:				boolean,
	groupString:			string
}

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
		//this.log.info(sprintf('%-30s %-20s %-50s', 'onReady()', 'mapping', '\n'+JSON.stringify(mapping, null, 4)));

		// create configs
		for (const [dstId, srcIdsObj] of Object.entries(mapping)) {
			const srcIds = Object.entries(srcIdsObj).filter(entry => (entry[1] === true)).map(entry => entry[0]).sort();
			const yahkaDstApt = await this.getForeignObjectAsync('system.adapter.' + dstId);
			if (! yahkaDstApt) {
				this.log.warn(sprintf('%-30s %-20s %-50s', 'onReady()', ('system.adapter.'+dstId), 'not installed'));
				delete mapping[dstId];
			} else {
				await this.createYahkaConfig(yahkaDstApt, srcIds);
			}
		}

		this.terminate ? this.terminate('yahka config updated. adapter stopped until next scheduled moment') : process.exit(0);
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

	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	// createYahkaConfig(yahkaDstApt, srcInsts)
	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	async createYahkaConfig(yahkaDstApt: ioBroker.Object, srcInsts: string[]): Promise<void> {		// e.g.: "system.adapter.yahka.0", [ "fritzdect.0", ... ]
		const yahkaAptId = yahkaDstApt._id;
		this.log.info(sprintf('%-30s %-20s %-50s', 'createYahkaConfig()', 'target', yahkaAptId));
		//this.log.info(sprintf('%-30s %-20s\n%s', 'createYahkaConfig()', yahkaAptId, JSON.stringify(srcInsts, null, 4)));

		// collect source state objects
		let iobSrcObjs: ioBroker.StateObject[] = [];
		for (let srcInst of srcInsts) {
			srcInst += '.*';
			const stateObjs  = await this.getForeignObjectsAsync(srcInst, 'state')  ||  {};
			const stateRegEx = new RegExp(srcInst.replace(/\./g, '\\.').replace(/\*/g, '[^\\.]*'));
			const statesArr  = Object.values(stateObjs).filter((obj) => (obj._id.match(stateRegEx) !== null));
			this.log.info(sprintf('%-30s %-20s %-50s', 'createYahkaConfig()', '#'+statesArr.length, stateRegEx));
			iobSrcObjs = iobSrcObjs.concat(statesArr);
		}
		iobSrcObjs.sort((obj1, obj2) => (obj1._id > obj2._id) ? +1 : ((obj1._id < obj2._id) ? -1 : 0));
		//this.log.info(sprintf('%-30s %-20s %-50s %s', 'createYahkaConfig()', '', 'yahkaObjs', '\n'+JSON.stringify(iobSrcObjs, null, 4)));

		// get yahkaNewDevs and enable/disable yahka configs
		const yahkaNewDevs = await this.createYahkaDevs(iobSrcObjs);
		const yahkaOldDevs = yahkaDstApt['native']['bridge']['devices']	as {name: string, enabled: boolean}[];
		//this.log.info(sprintf('%-30s %-20s %-50s %s', 'createYahkaConfig()', dstInst, 'yahkaOldDevs', '\n'+JSON.stringify(yahkaOldDevs, null, 4)));
		//this.log.info(sprintf('%-30s %-20s %-50s %s', 'createYahkaConfig()', dstInst, 'yahkaNewDevs', '\n'+JSON.stringify(yahkaNewDevs, null, 4)));

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
				this.log.warn(sprintf('%-30s %-20s %-50s %s', 'createYahkaConfig()', 'keeping', yahkaOldDev.name, ''));
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
			this.log.info(sprintf('%-30s %-20s %-50s %s', 'createYahkaConfig()', yahkaAptId, 'diff', '\n'+JSON.stringify(diff, null, 4)));
		}

		// save
		if (yahkaChanged) {
			this.log.info(sprintf('%-30s %-20s %-50s %s', 'createYahkaConfig()', yahkaAptId, 'saving yahka devices ...', ''));
			//	await this.extendForeignObjectAsync(dstInst, { 'native': { 'bridge': { 'devices': yahkaNewDevs } } });
			yahkaDstApt['native']['bridge']['devices'] = yahkaNewDevs;
			await this.setForeignObjectAsync(yahkaAptId, yahkaDstApt);
		}
	}

	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~
	// createYahkaDevs(iobSrcObjs)
	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~
	async createYahkaDevs(iobSrcObjs: ioBroker.StateObject[]): Promise<{name: string, enabled: boolean}[]> {		// iobSrcObjs: array of iobroker objects
		this.log.info(sprintf('%-30s %-20s %-50s', 'createYahkaDevs()', '#'+iobSrcObjs.length, '...'));
		const yahkaNewDevs = [];

		if (! Array.isArray(iobSrcObjs)) {
			this.log.warn(sprintf('%-30s %-20s %-50s %s', 'createYahkaDevs()', 'iobSrcObjs is not an arrray', '', ''));

		} else {
			// process array of iobSrcObjs
			for (const iobSrcObj of iobSrcObjs) {
				const yahkaNewDev = await this.createYahkaDev(iobSrcObjs, iobSrcObj);
				if  ( yahkaNewDev ) {
					yahkaNewDevs.push(yahkaNewDev);
				}
			}
		}

		this.log.info(sprintf('%-30s %-20s %-50s', 'createYahkaDevs()', '#'+iobSrcObjs.length, 'done.'));
		return yahkaNewDevs;
	}



	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	// createYahkaDev(iobSrcObjs, iobSrcObj)
	// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
	async createYahkaDev(iobSrcObjs: ioBroker.StateObject[], iobSrcObj: ioBroker.StateObject): Promise<DevConfig | null > {		// iobObj: iobroker object
		const objRole		= iobSrcObj.common.role;					// 'value.temperature'
		const objName		= iobSrcObj.common.name as string;			// 'OG.Küche.targettemp'
		const objValType	= iobSrcObj.common.type;					// 'string', 'boolean', 'number', ...
		const objId			= iobSrcObj._id;							// 'fritzdect.0.DECT_099950049420.tsoll'
		const idPath		= objId.split('.');							// [ 'fritzdect', '0', 'DECT_099950049420', 'tsoll' ]
		const idBase		= idPath.slice(0, -1).join('.');			// 'fritzdect.0.DECT_099950049420'
		const idLeaf		= idPath.slice(   -1)[0];					//                               'tsoll'
		//this.log.info(sprintf('%-30s %-20s %-50s', 'createYahkaDev()', objRole, objId));

		// yahka device config
		const devCfg: DevConfig = {
			'configType':		'customdevice',							// buggy: will not show up in iOS
			'name':				objId,									// NOTE: yahka adapter uses 'name' to build homekit UUID!
			'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
			'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
			'model':			objName,								// visible within iOS home app
			'firmware':			'?',									// visible within iOS home app
			'category':			'?',
			'services':			[],										// default
			'enabled':			true,
			'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
		};


		// ~~~~~~~~~~~~~~~~~~~~~~~~~
		// zigbee2mqtt device states
		// ~~~~~~~~~~~~~~~~~~~~~~~~~
		if (idPath[0] === 'zigbee2mqtt') {

		// ~~~~~~~~~~~~~~~~~~
		// danfoss-icon state
		// ~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'danfoss-icon') {
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
				const nameStr	= (await this.getForeignStateAsync(nameId) || {}).val || '?';		// 'Wohnzimmer'
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
			const nameStr	=    (await this.getForeignStateAsync(nameId) || {}).val || '?';			// 'Terrassenlampen'
			devCfg.firmware	= ''+(await this.getForeignStateAsync(idPath.slice(0,-2).join('.') + '.version') || {val:'?'}).val;

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
				devCfg.firmware	= ''+(await this.getForeignStateAsync(idPath.slice(0,-2).join('.') + '.version') || {val:'?'}).val;
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
			const nameStr	=    (await this.getForeignStateAsync(`${idBase}.DeviceName`			) || {}).val  ||  '?';		// 'Keller Sensor'
			devCfg.firmware	= ''+(await this.getForeignStateAsync(`${idBase}.INFO.Info1_Version`	) || {}).val  ||  '?';		// '12.1.1(tasmota)'

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
		} else if (idPath[0] === 'fritzdect'  &&  [ 'tsoll', 'tist', 'celsius' ].includes(idLeaf)) {						// 'fritzdect.0.......'
			const nameStr	=    (await this.getForeignStateAsync(`${idBase}.name`			) || {}).val ||	'?';		// 'Küche OG'
			devCfg.model	= ''+(await this.getForeignStateAsync(`${idBase}.productname`	) || {}).val ||	'?';		// 'FRITZ!DECT 301'
			devCfg.firmware	= ''+(await this.getForeignStateAsync(`${idBase}.fwversion`	) || {}).val ||	'?';		// '05.02'

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
						'type': "MotionSensor", 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': "MotionDetected",		'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
						]
					}
				];

			} else if (objRole === 'sensor.occupancy') {
				devCfg.category = AccCatId.Sensor;
				devCfg.services = [
					{
						'type': "OccupancySensor", 'subType': '', 'name': objName,
						'characteristics': [
							{ 'name': 'Name',				'inOutFunction': 'const',					'inOutParameters': objName	},
							{ 'name': "OccupancyDetected",	'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': objId	}
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
			this.log.warn(sprintf('%-30s %-20s %-50s', 'createYahkaDev()', 'not implemented', objId));

		// ~~~~~~~~~~~~~~~~~~
		// tradfri brightness		-		NOTE: not needed because tradfri exposes it's own homekit bridge!
		// ~~~~~~~~~~~~~~~~~~
		} else if (idPath[0] === 'tradfri'  &&  idLeaf === 'brightness') {						// tradfri.0.L-65551.lightbulb.brightness
			const deviceObj = await this.getForeignObjectAsync(idPath.slice(0, 3).join('.'));	// tradfri.0.L-65551
			this.log.info(sprintf('%-30s %-20s %-50s %s deviceObj %s', 'createYahkaDev()', objRole, idBase, idLeaf, JSON.stringify(deviceObj, null, 4)));

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
			this.log.info(sprintf('%-30s %-20s %-50s', 'createYahkaDev()', 'created', devCfg.name));
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
