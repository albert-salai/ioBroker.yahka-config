import { sprintf }				from 'sprintf-js';
import { AccCatId, type AccConfig, type GeneratorContext, type GeneratorResult } from '../lib/types';
import { constChar, objName, sortBy } from '../lib/helpers';


// createDreame: one switch per dreame shortcut
//		on  -> starts the shortcut (<did>.shortcuts.<id>.start), switch stays on while <id>.running is true
//		off -> robot returns to its station (<did>.remote.return-to-dock)
//		NOTE: dreame runs a command for any value written to .start / return-to-dock (even false),
//		so only the matching state is written; the other one gets 'undefined', which yahka skips.
export async function createDreame({ adapter, srcInstId }: GeneratorContext): Promise<GeneratorResult> {
	const accConfigs: AccConfig[] = [];
	const invalid: string[] = [];

	// NOTE: a pattern like '<inst>.*.shortcuts.*' finds nothing here (dreame device ids are negative numbers), so filter by id
	const isShortcut = (id: string): boolean => /^[^.]+\.\d+\.[^.]+\.shortcuts\.[^.]+$/.test(id);		// dreame.0.-124719312.shortcuts.32
	const channels = Object.values(await adapter.getForeignObjectsAsync(`${srcInstId}.*`, 'channel')).filter(channel => isShortcut(channel._id)).sort(sortBy('_id'));

	const hasDock = new Map<string, boolean>();					// per device: has 'return-to-dock'?
	for (const channel of channels) {
		const idPath = channel._id.split('.');					// [ 'dreame', '0', '-124719312', 'shortcuts', '32' ]
		const name	= objName(channel);
		const devId	= idPath.slice(0, 3).join('.');

		// dock command (vacuums only; mowers have no 'return-to-dock')
		const dockId = `${devId}.remote.return-to-dock`;
		if (! hasDock.has(devId)) { hasDock.set(devId, !! await adapter.getForeignObjectAsync(dockId)); }
		if (! hasDock.get(devId)) {
			adapter.log.debug(sprintf('%-31s %-50s %s', 'createDreame()', channel._id, 'no return-to-dock found, mower?'));
			invalid.push(channel._id);
			continue;
		}

		const running = `${channel._id}.running`;
		const accConfig: AccConfig = {
			'groupString':		srcInstId,					// used by adapter only
			'name':				channel._id,				// NOTE: yahka adapter uses 'name' to build homekit UUID!
			'model':			name,						// visible within iOS home app
			'category':			AccCatId.SWITCH,
			'manufacturer':		'dreame',					// visible within iOS home app
			'serial':			idPath.slice(2).join('.'),	// visible within iOS home app
			'availableState':	`${devId}.info.online`,
			'services':			[{
				'type': 'Switch',
				'subType': '',
				'name': name,
				'characteristics': [
					// 'On' needs different states for reading and writing, which plain 'ioBroker.State' cannot do:
					//		.running		read-only: true while the shortcut runs
					//		.start			write-only button: starts the shortcut
					//		return-to-dock	write-only button: sends the robot back to its station
					// 'ioBroker.MultiState' takes a list of { readState, writeState } entries (must be a real array, not JSON text):
					//		HomeKit value read	= array with one value per entry, i.e. [ running, running ]
					//		HomeKit value write	= array, element i is written to writeState of entry i; 'undefined' elements are skipped
					// entry 0 is the 'start' target, entry 1 the 'dock' target. readState is mandatory, so both read 'running'.
					{
						'name':					'On',
						'inOutFunction':		'ioBroker.MultiState',
						'inOutParameters':		[
							{
								'readState': running,
								'writeState': `${channel._id}.start`,
							},
							{
								'readState': running,
								'writeState': dockId,
							},
						],
						// the scripts translate between the single HomeKit boolean and the MultiState arrays:
						'conversionFunction':	'script',
						'conversionParameters':	{
							// [ running, running ] -> On (only the first element is used)
							'toHomeKit':	'return Array.isArray(value) ? !!value[0] : !!value;',
							// On  -> [ true, undefined ]: press 'start' only
							// Off -> [ undefined, true ]: press 'return-to-dock' only
							// never write false: dreame runs the command for any written value
							'toIOBroker':	'return value ? [true, undefined] : [undefined, true];',
						},
					},
					constChar('Name', name),
				],
			}],
		};
		accConfigs.push(accConfig);
		adapter.log.debug(sprintf('%-31s %-20s %-50s %s', 'createDreame()', 'Switch', accConfig.name, name));
	}

	return { devices: accConfigs, invalid, historyIds: [] };
}
