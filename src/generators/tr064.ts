import { sprintf } from 'sprintf-js';
import { AccCatId, type AccConfig, type AccService, type GeneratorContext, type GeneratorResult } from '../lib/types';
import { constChar, objName, onlyAck, sortBy } from '../lib/helpers';

// createTr064: one Switch per boolean state below <inst>.states.*
export async function createTr064({ adapter, srcInstId }: GeneratorContext): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];
	const historyIds: string[] = [];

	// collect source state objects
	const stateObjs = await adapter.getForeignObjectsAsync(`${srcInstId}.states.*`, 'state');
	for (const state of Object.values(stateObjs).sort(sortBy('_id'))) {
		const idPath = state._id.split('.'); // [ 'tr-064', '0', 'states', 'wps' ]
		if (state.common.type === 'boolean') {
			const name = objName(state);

			const accConfig: AccConfig = {
				category: AccCatId.SWITCH,
				name: state._id, // NOTE: yahka adapter uses 'name' to build homekit UUID!
				manufacturer: idPath.slice(0, 2).join('.'), // visible within iOS home app
				serial: idPath.slice(2).join('.'), // visible within iOS home app
				model: name, // visible within iOS home app
				services: [],
				groupString: idPath.slice(0, 2).join('.'), // used by adapter only
			};
			accConfigs.push(accConfig);

			const accService: AccService = {
				type: 'Switch',
				subType: '',
				name: name,
				characteristics: [constChar('Name', name), onlyAck('On', state._id)],
			};
			accConfig.services.push(accService);
			adapter.log.debug(
				sprintf('%-31s %-20s %-50s %s', 'createTr064()', accService.type, accConfig.name, accService.name),
			);
		}
	}

	return { devices: accConfigs, invalid: [], historyIds };
}
