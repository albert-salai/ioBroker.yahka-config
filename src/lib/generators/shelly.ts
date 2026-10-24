import { sprintf }				from 'sprintf-js';
import { AccCatId, type AccConfig, type AccService, type SrvCharacteristic, type GeneratorContext, type GeneratorResult } from '../types';
import { constChar, objName, onlyAck, sortBy } from '../helpers';




export async function createShelly({ adapter, srcInstId }: GeneratorContext): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];
	const historyIds: string[] = [];

	// collect source state objects
	const lightChannels	= await adapter.getForeignObjectsAsync(`${srcInstId}.*.lights`, 'channel');
	const relayChannels	= await adapter.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, 'channel');
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
			adapter.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_shelly()', accService.type, accConfig.name, accService.name));
		}
	}

	return { devices: accConfigs, invalid: [], historyIds };

}
