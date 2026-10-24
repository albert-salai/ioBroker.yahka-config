import * as utils					from '@iobroker/adapter-core';
import   mqtt 						from 'mqtt';
import { diff as deepDiff, Diff }	from 'deep-diff';
import { sprintf }					from 'sprintf-js';
import * as fs						from 'node:fs';
import * as path					from 'node:path';

// debug: if set, devices are written to <dir>/<dstId>.json instead of saving any ioBroker object
const DRYRUN_DIR = process.env['YAHKA_CONFIG_DRYRUN'];

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

// ZigbeeFeature (only the fields used here)
interface ZigbeeFeature {
	name:					string,
	type:					string,
	features?:				ZigbeeFeature[],
}

// ZigbeeExpose: either a plain feature, or a group with 'features' (light, switch, climate, cover, lock, fan, composite, ...)
interface ZigbeeExpose {
	type:					string,
	name?:					string,
	features?:				ZigbeeFeature[],
}

// ZigbeeDevice
//		see https://github.com/Koenkk/zigbee2mqtt/blob/master/lib/extension/bridge.ts#L812
interface ZigbeeDevice {
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

// Generated: result of one generator
interface Generated {
	devices:				AccConfig[],
	invalid:				string[],			// names of devices that exist at the source but cannot be generated
}


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

	public constructor(compactOptions?: { logLevel: string; compactInstance: number; compact: true }) {
		super({ 'name': 'yahka-config', ...compactOptions });
		this.on('ready',  this.onReady .bind(this));
		this.on('unload', this.onUnload.bind(this));
	}

	/**
	 * Is called when databases are connected and adapter received configuration.
	 */
	private async onReady(): Promise<void> {
		try {
			const mapping = this.config.mapping;

			// historyId
			const systemConfig = await this.getForeignObjectAsync('system.config');
			if (systemConfig) {
				this.historyId = systemConfig.common.defaultHistory || '';
			}

			// yahka dstId
			for (const [ dstId, srcIdsObj ] of Object.entries(mapping)) {
				try {
					const yahkaDst = await this.getForeignObjectAsync('system.adapter.' + dstId);
					if (! yahkaDst) {
						this.log.warn(sprintf('%-31s %-20s %-50s', 'onReady()', ('system.adapter.'+dstId), 'not installed'));
					} else {
						await this.updateYahkaDevices(dstId, srcIdsObj, yahkaDst);
					}
				} catch (err) {
					this.log.error(sprintf('%-31s %-20s %-50s %s', 'onReady()', dstId, 'failed', (err as Error).message));
				}
			}
		} catch (err) {
			this.log.error(sprintf('%-31s %-50s %s', 'onReady()', 'failed', (err as Error).message));
		} finally {
			// stop until next schedule
			this.terminate('yahka config updated. adapter stopped until next scheduled moment');
		}
	}


	/**
	 * Regenerates the devices of one yahka instance and saves them if they changed.
	 *
	 * @param dstId		yahka instance, e.g. 'yahka.0'
	 * @param srcIdsObj	source instances mapped to their enabled flag
	 * @param yahkaDst	object 'system.adapter.<dstId>'
	 */
	private async updateYahkaDevices(dstId: string, srcIdsObj: Record<string, boolean>, yahkaDst: ioBroker.Object): Promise<void> {
		for (const [ srcInstId, enabled ] of Object.entries(srcIdsObj)) {
			this.log.info(sprintf('%-31s %-20s %-50s %s', 'updateYahkaDevices()', dstId, srcInstId, (enabled ? 'enabled' : 'skipped')));
		}

		// bridge
		const native = yahkaDst.native as Record<string, unknown>;
		const bridge = native['bridge'] as { devices?: AccConfig[] } | undefined;
		if (! bridge) {
			this.log.warn(sprintf('%-31s %-20s %-50s', 'updateYahkaDevices()', dstId, 'skipped: native.bridge missing'));
			return;
		}

		// oldDevs		-		yahka adapter uses 'name' to build homekit UUID
		const oldDevs: AccConfig[] = bridge.devices ?? [];

		// createdDevs
		const generated = await this.createDevices(dstId, srcIdsObj, oldDevs);
		if (! generated) {
			// a missing source would mark its existing devices as obsolete, so keep the old config
			this.log.warn(sprintf('%-31s %-20s %-50s', 'updateYahkaDevices()', dstId, 'skipped: source failed, yahka devices left unchanged'));
			return;
		}
		const { devices: createdDevs, invalid } = generated;
		applyDefaults(createdDevs);

		// invalid devices that are new are skipped
		for (const name of invalid) {
			if (! oldDevs.some(oldDev => oldDev.name === name)) {
				this.log.warn(sprintf('%-31s %-20s %-30s', 'updateYahkaDevices()', 'skipped invalid', name));
			}
		}

		// newDevs
		const { newDevs, disabled, obsolete, added } = mergeDevices(oldDevs, createdDevs, invalid);
		for (const name of disabled	) { this.log.info(sprintf('%-31s %-20s %-30s', 'updateYahkaDevices()', 'disabled',	name)); }
		for (const name of obsolete	) { this.log.info(sprintf('%-31s %-20s %-30s', 'updateYahkaDevices()', 'obsolete',	name)); }
		for (const name of added	) { this.log.info(sprintf('%-31s %-20s %-30s', 'updateYahkaDevices()', 'added',		name)); }

		// log diffs between oldDevs and newDevs
		const diffs = deepDiff(oldDevs, newDevs);
		this.logDiffs('updateYahkaDevices()', diffs ?? []);

		// dry run
		if (DRYRUN_DIR) {
			fs.mkdirSync(DRYRUN_DIR, { recursive: true });
			fs.writeFileSync(path.join(DRYRUN_DIR, `${dstId}.json`), JSON.stringify(newDevs, null, '\t'));
			return;
		}

		// save
		if (diffs) {
			this.log.info(sprintf('%-31s %-20s %-50s %s', 'updateYahkaDevices()', dstId, 'saving yahka devices ...', ''));
			bridge.devices = newDevs;
			await this.setForeignObject('system.adapter.' + dstId, yahkaDst);
		}
	}


	/**
	 * Runs the generator of every enabled source instance.
	 *
	 * @returns	all created devices, or undefined if any generator failed or the names are not unique
	 */
	private async createDevices(dstId: string, srcIdsObj: Record<string, boolean>, oldDevs: AccConfig[]): Promise<Generated | undefined> {
		const generators: Record<string, (srcInstId: string) => Promise<Generated>> = {
			'danfossicon':		this.create_danfoss		.bind(this),
			'fritzdect':		this.create_fritzdect	.bind(this),
			'rpi-io':			this.create_by_role		.bind(this),
			'shelly':			this.create_shelly		.bind(this),
			'switchboard-io':	this.create_by_role		.bind(this),
			'tr-064':			this.create_tr064		.bind(this),
			'zigbee2mqtt':		this.create_zigbee2mqtt	.bind(this),
		};

		const result: Generated = { devices: [], invalid: [] };
		let failed = false;
		for (const [ srcInstId, enabled ] of Object.entries(srcIdsObj)) {
			const create = enabled ? generators[srcInstId.split('.')[0] ?? ''] : undefined;
			if (create) {
				try {
					const generated = await create(srcInstId);

					// an empty source (adapter stopped, no data yet) would mark all its devices obsolete
					if (generated.devices.length === 0  &&  generated.invalid.length === 0  &&  oldDevs.some(oldDev => oldDev.name.startsWith(`${srcInstId}.`))) {
						throw new Error('source returned no devices, but yahka config contains devices of this source');
					}
					result.devices.push(...generated.devices);
					result.invalid.push(...generated.invalid);
				} catch (err) {
					failed = true;
					this.log.error(sprintf('%-31s %-20s %-50s %s', 'createDevices()', dstId, srcInstId, `failed: ${(err as Error).message}`));
				}
			}
		}
		if (failed) {
			return undefined;
		}

		// names must be unique: they build the homekit UUID
		const names = new Set<string>();
		for (const { name } of result.devices) {
			if (names.has(name)) {
				this.log.error(sprintf('%-31s %-20s %-50s %s', 'createDevices()', dstId, name, 'failed: duplicate accessory name'));
				failed = true;
			}
			names.add(name);
		}
		return failed ? undefined : result;
	}


	private async create_tr064(srcInstId: string): Promise<Generated> {
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
					'model':			objName(state),		// visible within iOS home app
					'services':			[] as AccService[],
					'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
				};
				accConfigs.push(accConfig);

				const accService: AccService = {
					'type': 'Switch', 'subType': '', 'name': accConfig.model,
					'characteristics': [
						constChar('Name', accConfig.model),
						onlyAck('On', state._id)
					]
				};
				accConfig.services.push(accService);
				this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_tr064()', accService.type, accConfig.name, accService.name));
			}
		}

		return { devices: accConfigs, invalid: [] };
	}


	private async create_fritzdect(srcInstId: string): Promise<Generated> {
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
					characteristics.push(onlyAck('CurrentTemperature', `${channel._id}.celsius`));
					await this.enableHistory(`${channel._id}.celsius`);

				// FRITZ!Smart Energy 200
				} else if (productname.val === 'FRITZ!Smart Energy 200') {
					accCategory = AccCatId.Switch;
					srvType		= 'Switch';
					characteristics.push(onlyAck('On', `${channel._id}.state`));
					await this.enableHistory(`${channel._id}.state`);

				// FRITZ!Smart Thermo 301
				} else if (productname.val === 'FRITZ!Smart Thermo 301') {
					accCategory = AccCatId.Thermostat;
					srvType		= 'Thermostat';
					characteristics.push(
						constChar('TemperatureDisplayUnits', 0),
						onlyAck('TargetTemperature', channel._id+'.tsoll'),
						onlyAck('CurrentTemperature', channel._id+'.tist'),
						constChar('TargetHeatingCoolingState', 3),
						onlyAck('CurrentHeatingCoolingState', channel._id+'.heatingCoolingState'),
					);														// TargetHeatingCoolingState:	0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
					await this.enableHistory(`${channel._id}.tsoll`);		// CurrentHeatingCoolingState:	0 := OFF, 1 := HEAT, 2 := COOL
					await this.enableHistory(`${channel._id}.tist` );

				} else {
					this.log.error(sprintf('%-30s %-20s %-50s %s', 'create_fritzdect()', 'unknown', 'productname', String(productname.val)));
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
					characteristics.push(constChar('Name', devName));

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

		return { devices: accConfigs, invalid: [] };
	}

	private async create_shelly(srcInstId: string): Promise<Generated> {
		const accConfigs: AccConfig[] = [];

		// collect source state objects
		const lightChannels	= await this.getForeignObjectsAsync(`${srcInstId}.*.lights`, 'channel');
		const relayChannels	= await this.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, 'channel');
		const channels		= Object.values(lightChannels).concat(Object.values(relayChannels)).sort(sortBy('_id'));

		// channels
		for (const channel of channels) {
			const idPath	= channel._id.split('.');					// [ 'shelly', '0', 'SHDM-2#94B97E16BE61#1',	'lights' ]
			const name	= objName(channel);		// [ 'shelly', '0', 'SHPLG-S#6A0761#1',			'Relay0' ]

			// accCategory, srvType, characteristics
			let accCategory								= '';			//accCatIds[expose.type]
			let srvType									= '';
			const characteristics: SrvCharacteristic[]	= [];

			// Relay
			if ((idPath[3] ?? '').startsWith('Relay')) {
				accCategory = AccCatId.Switch;
				srvType		= 'Switch';
				characteristics.push(onlyAck('On', `${channel._id}.Switch`));

			// lights
			} else if (idPath[3] === 'lights') {
				accCategory = AccCatId.Lightbulb;
				srvType		= 'Lightbulb';
				characteristics.push(onlyAck('On', `${channel._id}.Switch`));
				characteristics.push(onlyAck('Brightness', `${channel._id}.brightness`));
			}

			// add devConfig
			if (accCategory  &&  srvType) {
				// name
				characteristics.push(constChar('Name', name));

				// accConfig
				const accConfig: AccConfig = {
					'groupString':		srcInstId,				// used by adapter only
					'name':				channel._id,			// NOTE: yahka adapter uses 'name' to build homekit UUID!
					'model':			name,					// visible within iOS home app
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

		return { devices: accConfigs, invalid: [] };
	}

	private async create_by_role(srcInstId: string): Promise<Generated> {
		const accConfigs: AccConfig[] = [];

		const pinObjs = await this.getForeignObjectsAsync(`${srcInstId}.*`, 'state');
		for (const pinObj of Object.values(pinObjs).sort(sortBy('_id'))) {
			const objId		= pinObj._id;									//   '0_userdata.0.pin.tür_tag'
			const idPath	= pinObj._id.split('.');						// [ '0_userdata', '0', 'pin', 'tür_tag' ]
			const objRole	= pinObj.common.role;							// 'value.temperature'
			const name		= objName(pinObj);		// 'Haustür'

			// yahka device config
			const accConfig: AccConfig = {
				'category':			'',
				'name':				objId,									// NOTE: yahka adapter uses 'name' to build homekit UUID!
				'manufacturer':		idPath.slice(0,2).join('.'),			// visible within iOS home app
				'serial':			idPath.slice(2  ).join('.'),			// visible within iOS home app
				'model':			name,								// visible within iOS home app
				'services':			[],										// default
				'groupString':		idPath.slice(0,2).join('.')				// used by adapter only
			};

			// sensor.contact
			if (objRole === 'sensor.contact') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'ContactSensor', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('ContactSensorState', objId),
						]
					}
				];

			// sensor.motion
			} else if (objRole === 'sensor.motion') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'MotionSensor', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('MotionDetected', objId)
						]
					}
				];

			// sensor.occupancy
			} else if (objRole === 'sensor.occupancy') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'OccupancySensor', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('OccupancyDetected', objId)
						]
					}
				];

			// sensor.leak
			} else if (objRole === 'sensor.leak') {
				accConfig.category = AccCatId.Sensor;
				accConfig.services = [
					{
						'type': 'LeakSensor', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('LeakDetected', objId)
						]
					}
				];

			// switch
			} else if (objRole === 'switch') {
				accConfig.category = AccCatId.Switch;
				accConfig.services = [
					{
						'type': 'Switch', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('On', objId)
						]
					}
				];

				// switch.light
			} else if (objRole === 'switch.light') {
				accConfig.category = AccCatId.Lightbulb;
				accConfig.services = [
					{
						'type': 'Lightbulb', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('On', objId)
						]
					}
				];

			// switch.lock.door
			} else if (objRole === 'switch.lock.door') {
				accConfig.category	= AccCatId.Door_lock;
				accConfig.services = [
					{
						'type': 'LockMechanism', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('LockTargetState',   objId,            { 'conversionFunction': 'invert' }),
							onlyAck('LockCurrentState',  objId+'_status', { 'conversionFunction': 'invert' }),
						]
					}
				];

			// switch.garage
			} else if (objRole === 'switch.garage') {
				accConfig.category	= AccCatId.Garage_door_opener ;
				accConfig.services = [
					{
						'type': 'GarageDoorOpener', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('TargetDoorState',   objId,            { 'conversionFunction': 'invert' }),
							onlyAck('CurrentDoorState',  objId+'_status', { 'conversionFunction': 'invert' }),
							constChar('ObstructionDetected', false),
						]
					}
				];

			// switch.fan
			} else if (objRole === 'switch.fan') {
				accConfig.category = AccCatId.Fan;
				accConfig.services = [
					{
						'type': 'Fan', 'subType': '', 'name': name,
						'characteristics': [
							constChar('Name', name),
							onlyAck('On', objId)
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

		return { devices: accConfigs, invalid: [] };
	}


	private async create_danfoss(srcInstId: string): Promise<Generated> {
		const accConfigs: AccConfig[] = [];
		const group = srcInstId;										// 'danfossicon.0'

		// danfossicon HousePause
		const housePause = await this.getForeignObjectAsync(`${srcInstId}.House.HousePause`);
		if (housePause) {
			const idPath	= housePause._id.split('.');				// [ 'danfossicon', '0', 'House', 'HousePause' ]
			const name		= objName(housePause);

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
					constChar('Name', name),
					onlyAck('On', housePause._id)
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
			const name		= objName(targetTempObj);

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
					constChar('Name', name),
					onlyAck('TargetTemperature', idBase+'.TargetTemp'),
					onlyAck('CurrentTemperature', idBase+'.RoomTemp'),
					constChar('TemperatureDisplayUnits', 0),
					constChar('TargetHeatingCoolingState', 3),
					onlyAck('CurrentHeatingCoolingState', idBase+'.ValveState', {
						'conversionFunction': 'script', 'conversionParameters': { 'toHomeKit': 'return (value) ? 1 : 2;', 'toIOBroker': 'return (value == 1);' }
					})		// TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
				]			// CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
			};
			accConfig.services.push(accService);
			this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_danfoss()', accService.type, accConfig.name, accService.name));
		}

		return { devices: accConfigs, invalid: [] };
	}


	private async create_zigbee2mqtt(srcInstId: string): Promise<Generated> {
		const accConfigs: AccConfig[] = [];
		const invalid: string[] = [];

		// zigbeeDevs
		const zigbeeDevs = await new Promise<ZigbeeDevice[]>((resolve, reject) => {
			const client = mqtt.connect('mqtt://127.0.0.1:1883');
			const finish = (err?: Error, devs?: ZigbeeDevice[]): void => {
				clearTimeout(timer);
				client.end();
				if (err) { reject(err); } else { resolve(devs ?? []); }
			};
			const timer = setTimeout(() => { finish(new Error('timeout waiting for zigbee2mqtt/bridge/devices')); }, 10000);
			client.on('error', (err: Error) => { finish(err); });
			client.on('connect', (_pkt: mqtt.IConnackPacket) => {
				client
					.on('message', (_topic: string, payload: Buffer, _pkt: mqtt.IPublishPacket) => {
						try {
							finish(undefined, JSON.parse(payload.toString()) as ZigbeeDevice[]);
						} catch (err) {
							finish(err as Error);
						}
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
			if (zigbeeDev) {

				// validate
				const grpName = idPath.slice(0, 2).join('.');
				const accName = `${grpName}.${ieeeAdr ?? ''}`;			// NOTE: yahka adapter uses 'name' to build homekit UUID!
				let definition: NonNullable<ZigbeeDevice['definition']>;
				try {
					definition = validateZigbeeDevice(zigbeeDev);
				} catch (err) {
					this.log.warn(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', 'invalid', iobDev._id, (err as Error).message));
					invalid.push(accName);
					continue;
				}
				const { ieee_address, friendly_name, software_build_id, model_id } = zigbeeDev;
				const { model, vendor, exposes } = definition;

				// accConfig
				const devName = friendly_name;
				const accConfig: AccConfig = {
					'groupString':		grpName,								// used only by iobroker adapter to group accessiries
					'name':				accName,
					'model':			devName,								// visible within iOS home app
					'manufacturer':		`${vendor} ${model_id} (${model})`,		// visible within iOS home app
					'serial':			ieee_address,							// visible within iOS home app
					'firmware':			software_build_id  ??  'n/a',			// visible within iOS home app
					'category':			'',										// accCatIds[expose.type]
					'services':			[],
					'availableState':	`${iobDev._id}.available`,
				};

				// typedFeatures, features, featureNames, exposedLight
				const features		= exposes.filter(expose => 'name'     in expose);
				const featureNames	= features.map(feature => feature.name);
				const typedFeatures	= exposes.filter(expose => 'features' in expose);
				const exposedLight	= typedFeatures.find(expose => (expose.type === 'light'));

				// Service Lightbulb
				if (exposedLight) {
					const characteristics: SrvCharacteristic[] = [];
					for (const feature of exposedLight.features  ??  []) {
						if (feature.name === 'state') {
							characteristics.push(onlyAck('On', `${iobDev._id}.state`));

						} else if (feature.name === 'brightness') {
							characteristics.push(onlyAck('Brightness', `${iobDev._id}.brightness`));

						} else if (feature.name === 'color_temp') {
							characteristics.push(onlyAck('ColorTemperature', `${iobDev._id}.colortemp`, {
								'conversionFunction':	'script',
								'conversionParameters': {
									'toHomeKit':		'return Math.max(153, value)',
									'toIOBroker':		'return Math.max(153, value)'
								}
							}));
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
							const characteristics: SrvCharacteristic[] = [onlyAck('ContactSensorState', `${iobDev._id}.opened`)];
							accConfig.services.push({
								'type': 'ContactSensor', 'subType': '', 'name': devName, 'characteristics':	characteristics,
								'isPrimary': true
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							accConfig.services.push(batteryService(iobDev._id, devName));
						}
					}

				// Service LeakSensor (+ Battery)
				} else if (featureNames.includes('water_leak')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor LeakSensor
						if (feature.name === 'water_leak') {
							const characteristics: SrvCharacteristic[] = [onlyAck('LeakDetected', `${iobDev._id}.detected`)];
							accConfig.services.push({
								'type': 'LeakSensor', 'subType': '', 'name': devName, 'characteristics': characteristics,
								'isPrimary': true
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							accConfig.services.push(batteryService(iobDev._id, devName));
						}
					}

				// Service OccupancySensor (+ LightSensor + Battery)
				} else if (featureNames.includes('occupancy')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor OccupancySensor
						if (feature.name === 'occupancy') {
							const characteristics: SrvCharacteristic[] = [onlyAck('OccupancyDetected', `${iobDev._id}.occupancy`)];
							accConfig.services.push({
								'type': 'OccupancySensor', 'subType': '', 'name': devName, 'characteristics': characteristics,
								'isPrimary': true
							});
						}

						// Sensor LightSensor
						if (feature.name === 'illuminance') {
							const characteristics: SrvCharacteristic[] = [
								onlyAck('CurrentAmbientLightLevel', `${iobDev._id}.illuminance`)
							];
							accConfig.services.push({
								'type': 'LightSensor', 'subType': '', 'name': `${devName} Helligkeit`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							accConfig.services.push(batteryService(iobDev._id, devName));
						}
					}

				// Service HumiditySensor (+ TemperatureSensor + Battery)
				} else if (featureNames.includes('humidity')) {
					accConfig.category = AccCatId.Sensor;

					for (const feature of features) {
						// Sensor humidity
						if (feature.name === 'humidity') {
							const characteristics: SrvCharacteristic[] = [onlyAck('CurrentRelativeHumidity', `${iobDev._id}.humidity`)];
							accConfig.services.push({
								'type': 'HumiditySensor', 'subType': '', 'name': devName, 'characteristics': characteristics,
								'isPrimary': true
							});
						}

						// Sensor temperature
						if (feature.name === 'temperature') {
							const characteristics: SrvCharacteristic[] = [onlyAck('CurrentTemperature', `${iobDev._id}.temperature`)];
							accConfig.services.push({
								'type': 'TemperatureSensor', 'subType': '', 'name': `${devName} Temperatur`, 'characteristics': characteristics,
								'linkTo': devName
							});
						}

						// Sensor Battery
						if (feature.name === 'battery') {
							accConfig.services.push(batteryService(iobDev._id, devName));
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
						accService.characteristics.push(constChar('Name', accService.name));
						this.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', accService.type, accConfig.name, accService.name));
					}

					// add accessory
					accConfigs.push(accConfig);
				}
			}
		}

		return { devices: accConfigs, invalid };
	}

	/**
	 * Logs deep-diff results, one line per change.
	 *
	 * @param caller	label shown in the log line
	 * @param diffs		result of deepDiff()
	 */
	private logDiffs(caller: string, diffs: Diff<unknown>[]): void {
		for (const diff of diffs) {
			if (diff.path) {
				const pathStr = diff.path.map((val) => (typeof val === 'number' ? `[${String(val)}]` : `.${String(val)}`)).join('');
				if		(diff.kind === 'N')		{ this.log.info(sprintf('%-31s %-20s %-30s %s',					caller, 'added',   pathStr, JSON.stringify(diff.rhs))); }
				else if (diff.kind === 'D')		{ this.log.info(sprintf('%-31s %-20s %-30s %s',					caller, 'deleted', pathStr, JSON.stringify(diff.lhs))); }
				else if (diff.kind === 'E')		{ this.log.info(sprintf('%-31s %-20s %-30s %-20s --> %-10s',	caller, 'edited',  pathStr, JSON.stringify(diff.lhs), JSON.stringify(diff.rhs))); }
				else /*  diff.kind === 'A' */	{ this.log.info(sprintf('%-31s %-20s %-30s %s',					caller, 'changed', pathStr, JSON.stringify(diff.item))); }
			}
		}
	}

	private async enableHistory(stateId: string): Promise<void> {
		if (this.historyId) {
			const oldObj = await this.getForeignObjectAsync(stateId);
			if (oldObj?.type !== 'state') {
				this.log.warn(sprintf('%-31s %-20s %-50s', 'enableHistory()', 'missing', stateId));

			} else {
				const newObj		= JSON.parse(JSON.stringify(oldObj)) as typeof oldObj;
				newObj.common.custom = newObj.common.custom ?? {};				// attach, otherwise a missing entry is lost
				const newCustom		= newObj.common.custom;
				const newHistory	= (newCustom[this.historyId]	?? {}) as Record<string, unknown>;
				newHistory['enabled'] = true;
				newCustom[this.historyId] = newHistory;

				// log diffs between oldObj and newObj
				const diffs = deepDiff(oldObj, newObj) ?? [];
				if (diffs.length > 0) {
					this.logDiffs('enableHistory()', diffs);

					// write newObj
					if (! DRYRUN_DIR) {
						await this.setForeignObject(stateId, newObj);
					}
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

// applyDefaults(devs): fills in default accessory fields and enables all characteristics
function applyDefaults(devs: AccConfig[]): void {
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
function mergeDevices(oldDevs: AccConfig[], createdDevs: AccConfig[], invalid: string[] = []): { newDevs: AccConfig[], disabled: string[], obsolete: string[], added: string[] } {
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


// validateZigbeeDevice(dev): returns dev.definition; throws if a field used by create_zigbee2mqtt() is missing or has the wrong type
function validateZigbeeDevice(dev: ZigbeeDevice): NonNullable<ZigbeeDevice['definition']> {
	const { ieee_address, friendly_name, software_build_id, model_id, definition } = dev;
	if (typeof ieee_address		!== 'string'								) { throw new Error('device ieee_address must be string'		); }
	if (typeof friendly_name	!== 'string'								) { throw new Error('device friendly_name must be string'		); }
	if (typeof model_id			!== 'string'								) { throw new Error('device model_id must be string'			); }
	if (software_build_id !== undefined  &&  typeof software_build_id !== 'string'	) { throw new Error('device software_build_id must be string'	); }
	if (typeof definition		!== 'object'  ||  definition === null		) { throw new Error('device definition must be object'			); }

	const { model, vendor, exposes } = definition;
	if (typeof model			!== 'string'								) { throw new Error('definition model must be string'			); }
	if (typeof vendor			!== 'string'								) { throw new Error('definition vendor must be string'			); }
	if (! Array.isArray(exposes)											) { throw new Error('definition exposes must be array'			); }

	const checkFeature = (feature: ZigbeeFeature): void => {
		if (typeof feature.name	!== 'string'								) { throw new Error('feature name must be string'				); }
		if (typeof feature.type	!== 'string'								) { throw new Error('feature type must be string'				); }
	};
	for (const expose of exposes) {
		if (Array.isArray(expose.features)) {
			expose.features.forEach(checkFeature);
		} else {
			checkFeature(expose as ZigbeeFeature);
		}
	}
	return definition;
}


// batteryService(iobDevId, devName): Battery service linked to the primary service 'devName'
function batteryService(iobDevId: string, devName: string): AccService {
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



// objName(obj): display name of an object, as shown in the iOS home app
function objName(obj: ioBroker.Object): string {
	return (typeof obj.common.name === 'string') ? obj.common.name : obj.common.name.en;
}


// onlyAck(name, stateId, extra): characteristic read from / written to an ioBroker state (ack only)
function onlyAck(name: string, stateId: string, extra: Partial<SrvCharacteristic> = {}): SrvCharacteristic {
	return { name, 'inOutFunction': 'ioBroker.State.OnlyACK', 'inOutParameters': stateId, ...extra };
}


// constChar(name, value): characteristic with a constant value
function constChar(name: string, value: string | number | boolean): SrvCharacteristic {
	return { name, 'inOutFunction': 'const', 'inOutParameters': value };
}


// sortBy(key)
function sortBy<T>(key: keyof T): ((a: T, b: T) => number) {
	return (a: T, b: T) => (a[key] > b[key]) ? 1 : ((a[key] < b[key]) ? -1 : 0);
}



if (require.main !== module) {
	module.exports = (compactOptions: {		// compact mode: host calls this factory instead of spawning a process
		logLevel:			string;
		compactInstance:	number;
		compact:			true
	}) => new YahkaConfig(compactOptions);
} else {
	(() => new YahkaConfig())();			// standalone process: start directly
}
