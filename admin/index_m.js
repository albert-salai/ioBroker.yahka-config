"use strict";
// @ts-nocheck
/*global jQuery socket M $ */
// eslint-disable-next-line quotes

/*	adapter WIKI:				see https://github.com/ioBroker/ioBroker/wiki/Adapter-Development-Documentation#adminhtml
	io			[object]		see https://github.com/socketio/socket.io-client/tree/1.7.2
	Adapter		[class]			see https://github.com/ioBroker/ioBroker.js-controller/blob/master/packages/adapter/src/lib/adapter/adapter.js
	adapter		[string]		see	https://github.com/ioBroker/ioBroker.admin/blob/master/src/js/adapter-settings.js
	socket		[object]		see https://github.com/ioBroker/ioBroker.socketio/blob/master/lib/socketCommands.js
	instance	[string]
	function	showMessage(message, title, icon)
	function	showError(error)
	function	getObject(id, callback)
	function	getState(id, callback)
	function	getEnums(_enum, callback)
	function	enumName2Id(enums, name)
	function	sendTo(_adapter_instance, command, message, callback)
	function	getAdapterInstances(_adapter, callback)
	function	getIsAdapterAlive(_adapter, callback)
	function	addToTable(tabId, value, $grid, _isInitial)
	function	editTable(tabId, cols, values, top, g_onChange)
	function	getTableResult(tabId, cols)
	function	values2table(divId, values, g_onChange, onReady, maxRaw)
	function	table2values(divId)

	// tableEditor:		https://github.com/ioBroker/ioBroker.admin/blob/master/src/js/tableEditor.js
	// selectID:		https://github.com/ioBroker/ioBroker.admin/blob/master/src/lib/js/selectID.js
*/

// jquery version 3.2.1
console.log('jQuery version: ' + (jQuery && jQuery.fn && jQuery.fn.jquery));


// asyncSocketCmd(cmd)
function asyncSocketCmd(cmd) {
	function handler() {								// handler function definition
		const args = Array.from(arguments);				// get handler call args
		//console.log(`asyncSocketCmd(): cmd ${cmd}, args: ${JSON.stringify(args)}`);

		return new Promise((resolve, reject) => {		// return Promise
			args.unshift(cmd);							// prepend cmd arg
			args.push((err, res) => {					// append  cb  arg
				if (err) {
					reject(err);
				} else {								// resolve to { 'id': rowVal, ... }
					resolve(res.rows.reduce((obj, row) => (obj[row.id] = row.value, obj), {}));
				}
			});
			socket.emit.apply(socket, args);
		});
	}
	return handler;										// return handler function
}


// ~~~~~~~~~~~~~~~~
// global functions
// ~~~~~~~~~~~~~~~~
const getObjectViewAsync = asyncSocketCmd('getObjectView');			// getObjectViewAsync(design, search, params)


// ~~~~~~~~~~~~~~~~
// global variables
// ~~~~~~~~~~~~~~~~
let settings = {};


// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// load() will be called by the admin adapter when the settings page loads
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// eslint-disable-next-line no-unused-vars
async function load(_settings, onChange) {
	settings = _settings  ||  {};
	onChange(true);				// always update settings

	// instIds
	const instIds = Object.keys(await getObjectViewAsync('system', 'instance', {})).map(id => id.replace('system.adapter.', ''));
	//console.log('load(): instIds: ' + JSON.stringify(instIds,	null, 4));

	// srcIds, dstIds
	const srcAdapters	= [ 'tr-064', 'fritzdect', 'tradfri', 'hue', 'hue-extended', 'shelly', 'sonoff', 'openweathermap', 'kernel', 'danfoss-icon', 'zwave' ];
	const srcIds		= instIds.filter(instId => srcAdapters.find(name => instId.startsWith(name + '.')));
	const dstIds		= instIds.filter(instId => instId.startsWith('yahka.'));
	console.log('load(): srcIds: ' + JSON.stringify(srcIds,	null, 4));
	console.log('load(): dstIds: ' + JSON.stringify(dstIds, null, 4));

	// mapping
	//console.log('load(): loaded  settings: ' + JSON.stringify(settings,	null, 4));
	const mapping = settings.mapping = settings.mapping  ||  {};			// { dstId: { srcId: false, ... }, ... }

	// add missing mappings
	for (const dstId of dstIds) {
		const dstMap = mapping[dstId] = mapping[dstId]  ||  {};
		for (const srcId of srcIds) {
			dstMap[srcId] = dstMap[srcId] || false;				// default := false
		}
	}

	// remove obsolete mappings
	for (const dstId of Object.keys(mapping)) {
		if (! dstIds.find(id => (id === dstId))) {				// mapping dstId missing in dstIds?
			delete mapping[dstId];
		} else {												// mapping dstId present in dstIds
			const dstMap = mapping[dstId];
			for (const srcId of Object.keys(dstMap)) {
				if (! srcIds.find(id => (id === srcId))) {		// mapping srcId missing in srcIds?
					delete dstMap[srcId];
				}
			}
		}
	}
	//console.log('load(): updated settings: ' + JSON.stringify(settings,	null, 4));

	// add yahka_mapping thead content
	let thead_txt = '<tr>';
	thead_txt += '<th>source instance</th>';
	for (const dstId of dstIds) {
		thead_txt += `<th>${dstId}</th>`;
	}
	thead_txt += '</tr>';
	$('#yahka_mapping').find('thead').html(thead_txt);

	// add yahka_mapping tbody content
	let tbody_txt = '';
	for (const srcId of srcIds) {
		tbody_txt += '<tr>';
		tbody_txt +=	`<td>${srcId}</td>`;
		for (const dstId of dstIds) {
			const checked = (mapping[dstId][srcId]) ? 'checked="checked"' : '';
			tbody_txt += `
				<td>
					<label>
						<input type="checkbox" class="filled-in" data-src-id="${srcId}" data-dst-id="${dstId}" ${checked} />
						<span></span>
					</label>
				</td>`;
		}
		tbody_txt += '</tr>';
	}
	$('#yahka_mapping').find('tbody').html(tbody_txt);

	// select elements with id=key, class=value and insert value
	$('.value').each(() => {
		const $key	= $(this);
		const id	= $key.attr('id');
		if ($key.attr('type') === 'checkbox')	{ $key.prop('checked', settings[id]);	}
		else									{ $key.val(            settings[id]);	}
	});

	// reinitialize all the Materialize labels on the page if you are dynamically adding inputs
	if (M) M.updateTextFields();
}


// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// save(cb) will be called by the admin adapter when the user presses the save button
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// eslint-disable-next-line no-unused-vars
function save(callback) {
	//console.log('save(): current settings: ' + JSON.stringify(settings,	null, 4));

	// save yahka_mapping
	const mapping = settings.mapping;				// { dstId: { srcId: false, ... }, ... }
	$('#yahka_mapping').find('input').each(function() {
		const $this	= $(this);
		const srcId = $this.data('src-id');
		const dstId = $this.data('dst-id');
		const dstOn = $this.prop('checked');
		//console.log(`save(): srcId ${JSON.stringify(srcId)}, dstId ${JSON.stringify(dstId)}, dstOn ${JSON.stringify(dstOn)}`);
		if (srcId  &&  dstId) {
			mapping[dstId][srcId] = dstOn;
		}
	});

	// select elements with class=value and update settings object
	$('.value').each(function() {
		const $this	= $(this);
		const valType	= $this.attr('type');
		const valId		= $this.attr('id');
		if		(valType === 'checkbox')	{ settings[valId] = $this.prop('checked');		}
		else if (valType === 'number'  )	{ settings[valId] = parseFloat($this.val());	}
		else								{ settings[valId] = $this.val();				}
	});

	// save settings
	console.log('save(): settings: ' + JSON.stringify(settings, null, 4));
	callback(settings);
}
