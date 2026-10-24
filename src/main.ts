import * as utils					from '@iobroker/adapter-core';
import { diff as deepDiff, Diff }	from 'deep-diff';
import { sprintf }					from 'sprintf-js';
import * as fs						from 'node:fs';
import * as path					from 'node:path';
import { createByRole }				from './lib/generators/by-role';
import { createDanfoss }			from './lib/generators/danfoss';
import { createFritzdect }			from './lib/generators/fritzdect';
import { createShelly }				from './lib/generators/shelly';
import { createTr064 }				from './lib/generators/tr064';
import { createZigbee2mqtt }		from './lib/generators/zigbee2mqtt';
import { applyDefaults, assertSourceNotEmpty, duplicateNames, mergeDevices } from './lib/merge';
import type { AccConfig, Generator, GeneratorResult } from './lib/types';

// debug: if set, devices are written to <dir>/<dstId>.json instead of saving any ioBroker object
const DRYRUN_DIR = process.env['YAHKA_CONFIG_DRYRUN'];

// generators by source adapter name
const GENERATORS: Record<string, Generator> = {
	'danfossicon':		createDanfoss,
	'fritzdect':		createFritzdect,
	'rpi-io':			createByRole,
	'shelly':			createShelly,
	'switchboard-io':	createByRole,
	'tr-064':			createTr064,
	'zigbee2mqtt':		createZigbee2mqtt,
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
		const { devices: createdDevs, invalid, historyIds } = generated;

		// history is enabled whether or not the yahka config changed
		for (const historyId of historyIds) {
			await this.enableHistory(historyId);
		}
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
	private async createDevices(dstId: string, srcIdsObj: Record<string, boolean>, oldDevs: AccConfig[]): Promise<GeneratorResult | undefined> {
		const result: GeneratorResult = { devices: [], invalid: [], historyIds: [] };
		let failed = false;
		for (const [ srcInstId, enabled ] of Object.entries(srcIdsObj)) {
			const adapterName = srcInstId.split('.')[0] ?? '';
			const create = (enabled  &&  Object.hasOwn(GENERATORS, adapterName)) ? GENERATORS[adapterName] : undefined;
			if (create) {
				try {
					const generated = await create({ adapter: this, srcInstId });

					assertSourceNotEmpty(srcInstId, generated, oldDevs);
					result.devices.push(...generated.devices);
					result.invalid.push(...generated.invalid);
					result.historyIds.push(...generated.historyIds);
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
		for (const name of duplicateNames(result.devices)) {
			this.log.error(sprintf('%-31s %-20s %-50s %s', 'createDevices()', dstId, name, 'failed: duplicate accessory name'));
			failed = true;
		}
		return failed ? undefined : result;
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


if (require.main !== module) {
	module.exports = (compactOptions: {		// compact mode: host calls this factory instead of spawning a process
		logLevel:			string;
		compactInstance:	number;
		compact:			true
	}) => new YahkaConfig(compactOptions);
} else {
	(() => new YahkaConfig())();			// standalone process: start directly
}
