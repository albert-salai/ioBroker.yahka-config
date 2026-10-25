import { sprintf }				from 'sprintf-js';
import { AccCatId, type AccConfig, type AccService, type GeneratorContext, type GeneratorResult } from '../lib/types';
import { constChar, objName, onlyAck, sortBy } from '../lib/helpers';


// createDanfoss: a 'House Pause' switch plus one thermostat per room (<inst>.room-*.TargetTemp);
// all thermostats are unavailable while the house is not connected (House.PeerConnected)
export async function createDanfoss({ adapter, srcInstId }: GeneratorContext): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];
	const historyIds: string[] = [];
	const group = srcInstId;										// 'danfossicon.0'

	// danfossicon HousePause
	const housePause = await adapter.getForeignObjectAsync(`${srcInstId}.House.HousePause`);
	if (housePause) {
		const idPath	= housePause._id.split('.');				// [ 'danfossicon', '0', 'House', 'HousePause' ]
		const name		= objName(housePause);

		const accConfig: AccConfig = {
			'groupString':		group,								// used only by iobroker adapter to group accessories
			'name':				housePause._id,						// NOTE: yahka adapter uses 'name' to build homekit UUID!
			'manufacturer':		group,								// visible within iOS home app
			'model':			name,								// visible within iOS home app
			'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
			'category':			AccCatId.Switch,
			'services':			[],
		};
		const accService: AccService = {
			'type': 'Switch',
			'subType': '',
			'name': name,
			'characteristics': [
				constChar('Name', name),
				onlyAck('On', housePause._id)
			]
		};
		accConfig.services.push(accService);
		accConfigs.push(accConfig);
		adapter.log.debug(sprintf('%-31s %-20s %-50s %s', 'createDanfoss()', accService.type, accConfig.name, accService.name));
	}

	// TargetTemp
	const targetTemps = await adapter.getForeignObjectsAsync(`${srcInstId}.room-*.TargetTemp`, 'state');
	for (const targetTempObj of Object.values(targetTemps).sort(sortBy('_id'))) {
		const idPath	= targetTempObj._id.split('.');				// [ 'danfossicon', '0', 'room-01', 'TargetTemp' ]
		const idBase	= idPath.slice(0, -1).join('.');			//   'danfossicon.0.room-01'
		const name		= objName(targetTempObj);

		const accConfig: AccConfig = {
			'category':			AccCatId.Thermostat,
			'name':				targetTempObj._id,					// NOTE: yahka adapter uses 'name' to build homekit UUID!
			'manufacturer':		group,								// visible within iOS home app
			'serial':			idPath.slice(2).join('.'),			// visible within iOS home app
			'model':			name,								// visible within iOS home app
			'services':			[],
			'groupString':		group,								// used by adapter only
			'availableState':	`${group}.House.PeerConnected`,
		};
		accConfigs.push(accConfig);

		const accService: AccService = {
			'type': 'Thermostat',
			'subType': '',
			'name': name,
			'characteristics': [
				constChar('Name', name),
				onlyAck('TargetTemperature', idBase + '.TargetTemp'),
				onlyAck('CurrentTemperature', idBase + '.RoomTemp'),
				constChar('TemperatureDisplayUnits', 0),
				constChar('TargetHeatingCoolingState', 3),
				onlyAck('CurrentHeatingCoolingState', idBase + '.ValveState', {
					'conversionFunction': 'script',
					'conversionParameters': {
						'toHomeKit': 'return (value) ? 1 : 2;',
						'toIOBroker': 'return (value == 1);',
					}
				})		// TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
			]			// CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
		};
		accConfig.services.push(accService);
		adapter.log.debug(sprintf('%-31s %-20s %-50s %s', 'createDanfoss()', accService.type, accConfig.name, accService.name));
	}

	return { devices: accConfigs, invalid: [], historyIds };
}
