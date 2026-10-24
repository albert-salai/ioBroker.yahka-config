import { sprintf }				from 'sprintf-js';
import { AccCatId, type AccConfig, type AccService, type GeneratorContext, type GeneratorResult } from '../types';
import { constChar, objName, onlyAck, sortBy } from '../helpers';




export async function createTr064({ adapter, srcInstId }: GeneratorContext): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];
	const historyIds: string[] = [];

	// collect source state objects
	const stateObjs  = await adapter.getForeignObjectsAsync(`${srcInstId}.states.*`, 'state');
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
			adapter.log.debug(sprintf('%-30s %-20s %-50s %s', 'create_tr064()', accService.type, accConfig.name, accService.name));
		}
	}

	return { devices: accConfigs, invalid: [], historyIds };

}
