"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var io_adapter_exports = {};
__export(io_adapter_exports, {
  IoAdapter: () => IoAdapter,
  dateStr: () => dateStr,
  valStr: () => valStr
});
module.exports = __toCommonJS(io_adapter_exports);
var import_adapter_core = require("@iobroker/adapter-core");
var import_async_mutex = require("async-mutex");
var import_sprintf_js = require("sprintf-js");
var import_json_stable_stringify = __toESM(require("json-stable-stringify"));
function dateStr(ts = Date.now()) {
  const d = new Date(ts);
  return (0, import_sprintf_js.sprintf)("%02d.%02d.%04d %02d:%02d:%02d", d.getDate(), d.getMonth() + 1, d.getFullYear(), d.getHours(), d.getMinutes(), d.getSeconds());
}
function valStr(val) {
  if (typeof val === "number") {
    return isFinite(val) ? (Math.round(val * 1e6) / 1e6).toString() : val.toString();
  } else if (typeof val === "boolean") {
    return val ? "ON" : "OFF";
  } else if (typeof val === "string") {
    return val;
  } else {
    return JSON.stringify(val);
  }
}
;
class IoAdapter extends import_adapter_core.Adapter {
  static self;
  historyId = "";
  // 'sql.0'
  stateChangeSpecs = {};
  // by stateId
  stateObject = {};
  // by stateId
  mutex = new import_async_mutex.Mutex();
  saveConfig;
  logf = {
    "silly": (_fmt, ..._args) => {
    },
    "info": (_fmt, ..._args) => {
    },
    "debug": (_fmt, ..._args) => {
    },
    "warn": (_fmt, ..._args) => {
    },
    "error": (_fmt, ..._args) => {
    }
  };
  static get() {
    return IoAdapter.self;
  }
  /**
   *
   * @param options
   */
  constructor(options) {
    super(options);
    IoAdapter.self = this;
    this.saveConfig = false;
    this.on("ready", async () => {
      var _a, _b;
      try {
        await this.setState("info.connection", false, true);
        process.on("unhandledRejection", (reason, p) => {
          var _a2;
          this.log.error(`unhandledRejection ${reason} ${JSON.stringify(p, null, 4)} ${(_a2 = new Error("").stack) != null ? _a2 : ""}`);
        });
        process.on("uncaughtException", (err, origin) => {
          this.log.error(`uncaughtException ${err}
${origin}`);
        });
        const pad = " ".repeat(Math.max(0, 16 - this.namespace.length));
        this.logf.silly = (fmt, ...args) => {
          this.log.silly((0, import_sprintf_js.sprintf)(pad + fmt, ...args));
        };
        this.logf.info = (fmt, ...args) => {
          this.log.info((0, import_sprintf_js.sprintf)(pad + " " + fmt, ...args));
        };
        this.logf.debug = (fmt, ...args) => {
          this.log.debug((0, import_sprintf_js.sprintf)(pad + fmt, ...args));
        };
        this.logf.warn = (fmt, ...args) => {
          this.log.warn((0, import_sprintf_js.sprintf)(pad + " " + fmt, ...args));
        };
        this.logf.error = (fmt, ...args) => {
          this.log.error((0, import_sprintf_js.sprintf)(pad + fmt, ...args));
        };
        const systemConfig = await this.getForeignObjectAsync("system.config");
        this.historyId = (_a = systemConfig == null ? void 0 : systemConfig.common.defaultHistory) != null ? _a : "";
        await this.onReady();
        await this.setState("info.connection", true, true);
        if (this.saveConfig) {
          await this.updateConfig(this.config);
          return;
        }
      } catch (e) {
        const stack = e instanceof Error ? (_b = e.stack) != null ? _b : "" : JSON.stringify(e);
        this.log.error(stack);
        await this.setState("info.connection", false, true);
      }
    });
    this.on("stateChange", (stateId, stateChange) => {
      void this.runExclusive(async () => {
        if (stateChange) {
          const { val, ack, ts } = stateChange;
          if (val === null) {
            this.logf.warn("%-15s %-15s %-10s %-50s", this.constructor.name, "onChange()", "val null", stateId);
          } else {
            await this.onChange(stateId, { val, ack, ts });
          }
        } else {
          this.logf.warn("%-15s %-15s %-10s %-50s", this.constructor.name, "onChange()", "deleted", stateId);
        }
      });
    });
    this.on("unload", async (callback) => {
      var _a;
      try {
        await this.onUnload();
      } catch (e) {
        this.log.error(e instanceof Error ? (_a = e.stack) != null ? _a : "" : JSON.stringify(e));
      } finally {
        callback();
      }
    });
  }
  /**
   *
   */
  save_config() {
    this.logf.warn("%-15s %-15s %-10s %-50s", this.constructor.name, "save_config()", "", "will restart ...");
    this.saveConfig = true;
  }
  /**
   *
   */
  async onReady() {
  }
  /**
   *
   */
  async onUnload() {
  }
  /**
   *
   * @param cb
   * @returns
   */
  async runExclusive(cb) {
    return this.mutex.runExclusive(cb);
  }
  /**
   *
   * @param stateId
   * @param common
   */
  async writeFolderObj(stateId, common) {
    const obj = {
      "type": "folder",
      "common": common,
      "native": {}
    };
    await this.setForeignObject(stateId, obj);
  }
  /**
   *
   * @param stateId
   * @param common
   */
  async writeDeviceObj(stateId, common) {
    const obj = {
      "type": "device",
      "common": common,
      "native": {}
    };
    await this.setForeignObject(stateId, obj);
  }
  /**
   *
   * @param stateId
   * @param common
   */
  async writeChannelObj(stateId, common) {
    const obj = {
      "type": "channel",
      "common": common,
      "native": {}
    };
    await this.setForeignObject(stateId, obj);
  }
  /**
   *
   * @param stateId
   * @param common
   */
  //
  async writeStateObj(stateId, opts) {
    var _a, _b, _c, _d, _e;
    const optsCommon = Object.assign({ "role": "value", "read": true, "write": false }, opts.common);
    const oldObj = { "type": "state", "common": {}, "native": {} };
    const newObj = { "type": "state", "common": optsCommon, "native": (_a = opts.native) != null ? _a : {} };
    let stateObj = await this.getForeignObjectAsync(stateId);
    if (stateObj) {
      Object.assign(oldObj.common, stateObj.common);
      Object.assign(oldObj.native, stateObj.native);
    }
    if (this.historyId) {
      const optsHistory = (_b = opts.history) != null ? _b : { enabled: false };
      if (optsHistory.enabled) {
        const newCustom = newObj.common.custom = (_c = newObj.common.custom) != null ? _c : {};
        const newHistory = (_d = newCustom[this.historyId]) != null ? _d : { "enabled": false };
        newCustom[this.historyId] = Object.assign(newHistory, optsHistory, {
          //	'storageType':						(common.type[0] || '').toUpperCase() + common.type.slice(1),
          //	'storageType':						'',
          //	'maxLength':	0,
          //	'retention':	0,					// [s]
          //	'changesOnly': true,
          //	'changesRelogInterval': 0,
          //	'changesMinDelta': 0,
          //	'ignoreBelowNumber': '',
          //	'debounceTime': 0,
          //	'blockTime': 0,
          //	'changesRelogInterval': 0,
          //	'enableDebugLogs': false,
        });
      } else if (oldObj.common.custom) {
        const oldCustom = oldObj.common.custom;
        const oldHistory = oldCustom[this.historyId];
        if (oldHistory) {
          const newCustom = newObj.common.custom = (_e = newObj.common.custom) != null ? _e : {};
          newCustom[this.historyId] = oldHistory;
        }
      }
    }
    const oldStr = (0, import_json_stable_stringify.default)(oldObj, { space: 4 });
    const newStr = (0, import_json_stable_stringify.default)(newObj, { space: 4 });
    if (!stateObj || newStr !== oldStr) {
      this.logf.debug("%-15s %-15s %-10s %-50s\n%s", this.constructor.name, "writeStateObj()", "oldObj", stateId, oldStr);
      this.logf.debug("%-15s %-15s %-10s %-50s\n%s", this.constructor.name, "writeStateObj()", "newObj", stateId, newStr);
      await this.setForeignObject(stateId, newObj);
      stateObj = await this.getForeignObjectAsync(stateId);
    }
    if ((stateObj == null ? void 0 : stateObj.type) !== "state") {
      throw new Error(`${this.constructor.name}: writeStateObj(): invalid stateObj`);
    }
    return stateObj;
  }
  /**
   *
   * @param stateId
   * @returns
   */
  async readStateObject(stateId) {
    var _a;
    const obj = (_a = await this.getForeignObjectAsync(stateId)) != null ? _a : null;
    return (obj == null ? void 0 : obj.type) === "state" ? obj : null;
  }
  /**
   *
   * @param stateId
   * @param state
   */
  async writeState(stateId, state) {
    await this.setForeignStateAsync(stateId, state);
  }
  /**
   *
   * @param stateId
   * @returns
   */
  async readState(stateId) {
    var _a;
    return (_a = await this.getForeignStateAsync(stateId)) != null ? _a : null;
  }
  /**
   *
   * @param spec
   */
  async subscribe(spec) {
    var _a;
    const stateId = spec.stateId;
    const specs = this.stateChangeSpecs[stateId] = (_a = this.stateChangeSpecs[stateId]) != null ? _a : [];
    const len = specs.push(spec);
    this.logf.debug("%-15s %-15s %-10s %-50s %-4s %s", this.constructor.name, "subscribe()", `#${String(len - 1)}`, stateId, String("val" in spec ? spec.val : "any"), "ack" in spec ? spec.ack ? "ack" : "cmd" : "*");
    if (len === 1) {
      const stateObj = await this.readStateObject(stateId);
      if (stateObj) {
        this.stateObject[stateId] = stateObj;
        await this.subscribeForeignStatesAsync(stateId);
      }
    }
  }
  /**
   *
   * @param spec
   */
  async unsubscribe(spec) {
    var _a;
    const stateId = spec.stateId;
    const specs = ((_a = this.stateChangeSpecs[stateId]) != null ? _a : []).filter((s) => s !== spec);
    this.stateChangeSpecs[stateId] = specs;
    this.logf.debug("%-15s %-15s %-10s %-50s %-4s %s", this.constructor.name, "unsubscribe()", `#${String(specs.length)}`, stateId, String("val" in spec ? spec.val : "any"), "ack" in spec ? spec.ack ? "ack" : "cmd" : "*");
    if (specs.length === 0) {
      await this.unsubscribeForeignStatesAsync(stateId);
    }
  }
  /**
   *
   * @param spec
   */
  async subscribeOnce(spec) {
    const cb = spec.cb;
    spec.cb = async (stateChange) => {
      await this.unsubscribe(spec);
      await cb(stateChange);
    };
    await this.subscribe(spec);
  }
  /**
   *
   * @param stateId
   * @param state
   */
  async onChange(stateId, { val, ack, ts }) {
    const specs = this.stateChangeSpecs[stateId];
    if (!specs) {
      this.logf.error("%-15s %-15s %-10s %-50s %s   %-3s %s", this.constructor.name, "onChange()", "no spec", stateId, dateStr(ts), ack ? "" : "cmd", valStr(val));
    } else {
      for (const spec of specs) {
        const valMatch = "val" in spec ? spec.val === val : true;
        const ackMatch = "ack" in spec ? spec.ack === ack : true;
        if (valMatch && ackMatch) {
          await spec.cb({ val, ack, ts });
        }
      }
    }
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IoAdapter,
  dateStr,
  valStr
});
//# sourceMappingURL=io-adapter.js.map
