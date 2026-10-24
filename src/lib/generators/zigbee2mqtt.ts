import mqtt							from 'mqtt';
import { sprintf }					from 'sprintf-js';
import { AccCatId, type AccConfig, type GeneratorContext, type GeneratorResult, type SrvCharacteristic, type ZigbeeDevice, type ZigbeeFeature } from '../types';
import { batteryService, constChar, onlyAck } from '../helpers';


// ~~~~~~~~~~
// SENSOR_MAP
// ~~~~~~~~~~
// zigbee2mqtt sensors, tried in this order; the first whose primary feature is exposed wins.
// Services are created in the order of the exposed features: primary, linked and battery.
interface ZigbeeSensor { type: string, characteristic: string, stateSuffix: string }
const SENSOR_MAP: { primaryFeature: string, primary: ZigbeeSensor, linked: Record<string, ZigbeeSensor & { label: string }> }[] = [
	{	primaryFeature: 'contact',
		primary: { type: 'ContactSensor', characteristic: 'ContactSensorState', stateSuffix: 'opened' },
		linked: {}
	},
	{	primaryFeature: 'water_leak',
		primary: { type: 'LeakSensor', characteristic: 'LeakDetected', stateSuffix: 'detected' },
		linked: {}
	},
	{	primaryFeature: 'occupancy',
		primary: { type: 'OccupancySensor', characteristic: 'OccupancyDetected', stateSuffix: 'occupancy' },
		linked: { 'illuminance': { type: 'LightSensor', characteristic: 'CurrentAmbientLightLevel', stateSuffix: 'illuminance', label: 'Helligkeit' } }
	},
	{	primaryFeature: 'humidity',
		primary: { type: 'HumiditySensor', characteristic: 'CurrentRelativeHumidity', stateSuffix: 'humidity' },
		linked: { 'temperature': { type: 'TemperatureSensor', characteristic: 'CurrentTemperature', stateSuffix: 'temperature', label: 'Temperatur' } }
	},
];


// MqttSettings: where to read 'bridge/devices' from
export interface MqttSettings {
	url:		string,
	username?:	string,
	password?:	string,
	topic:		string,
}

// zigbeeMqttSettings(native): broker and base topic of a zigbee2mqtt instance; defaults to the local broker
export function zigbeeMqttSettings(native: Record<string, unknown> | undefined): MqttSettings {
	const str = (key: string): string | undefined => (typeof native?.[key] === 'string'  &&  native[key] !== '') ? native[key] : undefined;
	const num = (key: string): number | undefined => (typeof native?.[key] === 'number') ? native[key] : undefined;

	const baseTopic	= str('baseTopic') ?? 'zigbee2mqtt';
	const settings: MqttSettings = { url: 'mqtt://127.0.0.1:1883', topic: `${baseTopic}/bridge/devices` };

	if (native?.['connectionType'] === 'exmqtt'  &&  str('externalMqttServerIP')) {
		settings.url = `mqtt://${str('externalMqttServerIP') ?? ''}:${String(num('externalMqttServerPort') ?? 1883)}`;
		if (native['externalMqttServerCredentials'] === true) {
			const username = str('externalMqttServerUsername');
			const password = str('externalMqttServerPassword');
			if (username !== undefined) { settings.username = username; }
			if (password !== undefined) { settings.password = password; }
		}
	} else if (native?.['connectionType'] === 'intmqtt'  &&  num('mqttServerPort')) {
		settings.url = `mqtt://127.0.0.1:${String(num('mqttServerPort') ?? 0)}`;
	}
	return settings;
}


// fetchZigbeeDevices(settings): waits for the retained 'bridge/devices' message
export function fetchZigbeeDevices(settings: MqttSettings): Promise<ZigbeeDevice[]> {
	return new Promise<ZigbeeDevice[]>((resolve, reject) => {
		const options: mqtt.IClientOptions = {};
		if (settings.username !== undefined) { options.username = settings.username; }
		if (settings.password !== undefined) { options.password = settings.password; }
		const client = mqtt.connect(settings.url, options);
		const finish = (err?: Error, devs?: ZigbeeDevice[]): void => {
			clearTimeout(timer);
			client.end();
			if (err) { reject(err); } else { resolve(devs ?? []); }
		};
		const timer = setTimeout(() => { finish(new Error(`timeout waiting for ${settings.topic}`)); }, 10000);
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
				.subscribe(settings.topic);
		});
	});
}


// validateZigbeeDevice(dev): returns dev.definition; throws if a field used by create_zigbee2mqtt() is missing or has the wrong type
export function validateZigbeeDevice(dev: ZigbeeDevice): NonNullable<ZigbeeDevice['definition']> {
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


export async function createZigbee2mqtt({ adapter, srcInstId }: GeneratorContext, fetchDevices = fetchZigbeeDevices): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];
	const historyIds: string[] = [];
	const invalid: string[] = [];

	// zigbeeDevs
	const sourceObj		= await adapter.getForeignObjectAsync(`system.adapter.${srcInstId}`);
	const zigbeeDevs	= await fetchDevices(zigbeeMqttSettings(sourceObj?.native));

	// mqttDevs
	const iobDevs = await adapter.getForeignObjectsAsync(`${srcInstId}.*`, 'device');
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
				adapter.log.warn(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', 'invalid', iobDev._id, (err as Error).message));
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

			// Service sensor (+ linked sensor + Battery)
			} else {
				const sensor = SENSOR_MAP.find(sensor => featureNames.includes(sensor.primaryFeature));
				if (sensor) {
					accConfig.category = AccCatId.Sensor;
					for (const feature of features) {
						const linked = Object.hasOwn(sensor.linked, feature.name ?? '') ? sensor.linked[feature.name ?? ''] : undefined;
						if (feature.name === sensor.primaryFeature) {
							const { type, characteristic, stateSuffix } = sensor.primary;
							accConfig.services.push({
								'type': type, 'subType': '', 'name': devName, 'characteristics': [ onlyAck(characteristic, `${iobDev._id}.${stateSuffix}`) ],
								'isPrimary': true
							});
						}
						if (linked) {
							accConfig.services.push({
								'type': linked.type, 'subType': '', 'name': `${devName} ${linked.label}`,
								'characteristics': [ onlyAck(linked.characteristic, `${iobDev._id}.${linked.stateSuffix}`) ],
								'linkTo': devName
							});
						}
						if (feature.name === 'battery') {
							accConfig.services.push(batteryService(iobDev._id, devName));
						}
					}
				}
			}

			// enable history
			if (featureNames.includes('linkquality')) {
				historyIds.push(`${iobDev._id}.link_quality`);
			}
			historyIds.push(`${iobDev._id}.available`);

			// add devConfig
			if (accConfig.category !== '') {
				// add Name characteristic to every service
				for (const accService of accConfig.services) {
					accService.characteristics.push(constChar('Name', accService.name));
					adapter.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_zigbee2mqtt()', accService.type, accConfig.name, accService.name));
				}

				// add accessory
				accConfigs.push(accConfig);
			}
		}
	}

	return { devices: accConfigs, invalid, historyIds };

}
