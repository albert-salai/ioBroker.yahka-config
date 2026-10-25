import { sprintf }				from 'sprintf-js';
import { AccCatId, type AccConfig, type GeneratorContext, type GeneratorResult } from '../lib/types';
import { constChar, objName, onlyAck, sortBy } from '../lib/helpers';


// createShelly: a Switch per relay channel (<inst>.*.Relay*) and a Lightbulb per light channel (<inst>.*.lights);
// a device is unavailable while its '<device>.online' state is false
export async function createShelly({ adapter, srcInstId }: GeneratorContext): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];

	// collect source channels
	const lightChannels	= await adapter.getForeignObjectsAsync(`${srcInstId}.*.lights`, 'channel');
	const relayChannels	= await adapter.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, 'channel');
	const channels		= [ ...Object.values(lightChannels), ...Object.values(relayChannels) ].sort(sortBy('_id'));

	for (const channel of channels) {
		const idPath	= channel._id.split('.');					// [ 'shelly', '0', 'SHDM-2#94B97E16BE61#1', 'lights' ] or [ 'shelly', '0', 'SHPLG-S#6A0761#1', 'Relay0' ]
		const name		= objName(channel);

		const isRelay = (idPath[3] ?? '').startsWith('Relay');
		const isLight = (idPath[3] === 'lights');
		if (! isRelay  &&  ! isLight) {
			continue;
		}

		// relay: switch only; light: switch + brightness
		const characteristics = [ onlyAck('On', `${channel._id}.Switch`) ];
		if (isLight) {
			characteristics.push(onlyAck('Brightness', `${channel._id}.brightness`));
		}
		characteristics.push(constChar('Name', name));

		const type = isLight ? 'Lightbulb' : 'Switch';
		const accConfig: AccConfig = {
			'groupString':		srcInstId,								// used by adapter only
			'name':				channel._id,							// NOTE: yahka adapter uses 'name' to build homekit UUID!
			'model':			name,									// visible within iOS home app
			'category':			isLight ? AccCatId.LIGHTBULB : AccCatId.SWITCH,
			'manufacturer':		'shelly',								// visible within iOS home app
			'serial':			idPath.slice(2, 4).join('.'),			// visible within iOS home app
			'availableState':	`${idPath.slice(0, 3).join('.')}.online`,
			'services':			[{
				'type':				type,
				'subType':			'',
				'name':				name,
				'characteristics':	characteristics,
			}],
		};
		accConfigs.push(accConfig);
		adapter.log.debug(sprintf('%-31s %-20s %-50s %s', 'createShelly()', type, accConfig.name, name));
	}

	return { devices: accConfigs, invalid: [], historyIds: [] };
}
