"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
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
var utils = __toESM(require("@iobroker/adapter-core"));
var import_io_util = require("./lib/io-util");
var import_sprintf_js = require("sprintf-js");
var import_deep_diff = require("deep-diff");
var import_mqtt = __toESM(require("mqtt"));
;
;
;
const AccCatId = {
  "AIRPORT": "27",
  "AIR_CONDITIONER": "21",
  "AIR_DEHUMIDIFIER": "23",
  "AIR_HEATER": "20",
  "AIR_HUMIDIFIER": "22",
  "AIR_PURIFIER": "19",
  "APPLE_TV": "24",
  "AUDIO_RECEIVER": "34",
  "Alarm_system": "11",
  "Bridge": "2",
  "Camera": "17",
  "Door": "12",
  "Door_lock": "6",
  "FAUCET": "29",
  "Fan": "3",
  "Garage_door_opener": "4",
  "HOMEPOD": "25",
  "Lightbulb": "5",
  "Other": "1",
  "Outlet": "7",
  "Programmable_switch": "15",
  "ROUTER": "33",
  "Range_extender": "16",
  "SHOWER_HEAD": "30",
  "SPEAKER": "26",
  "SPRINKLER": "28",
  "Sensor": "10",
  "Switch": "8",
  "TARGET_CONTROLLER": "32",
  "TELEVISION": "31",
  "TV_SET_TOP_BOX": "35",
  "TV_STREAMING_STIC": "36",
  "Thermostat": "9",
  "VIDEO_DOORBELL": "18",
  "Window": "13",
  "Window_covering": "14"
};
class YahkaConfig extends utils.Adapter {
  historyId = "";
  // CONSTRUCTOR
  constructor(options = {}) {
    super({
      ...options,
      name: "yahka-config"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  /**
   * Is called when databases are connected and adapter received configuration.
   */
  async onReady() {
    var _a, _b;
    const mapping = this.config.mapping;
    this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "onReady()", "mapping", "\n" + JSON.stringify(mapping, null, 4)));
    const systemConfig = await this.getForeignObjectAsync("system.config");
    if (systemConfig) {
      this.historyId = systemConfig.common.defaultHistory || "";
    }
    for (const [dstId, srcIdsObj] of Object.entries(mapping)) {
      const yahkaDst = await this.getForeignObjectAsync("system.adapter." + dstId);
      if (!yahkaDst) {
        this.log.warn((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "onReady()", "system.adapter." + dstId, "not installed"));
        delete mapping[dstId];
      } else {
        const native = yahkaDst.native;
        const bridge = native["bridge"] ? native["bridge"] : {};
        const oldDevs = (_a = bridge.devices) != null ? _a : [];
        let createdDevs = [];
        const srcInstIds = Object.entries(srcIdsObj).filter((entry) => entry[1]).map((entry) => entry[0]).sort();
        for (const srcInstId of srcInstIds.sort()) {
          const adapter = srcInstId.split(".")[0];
          if (adapter === "danfoss-icon") {
            createdDevs = createdDevs.concat(await this.create_danfoss(srcInstId, yahkaDst));
          } else if (adapter === "fritzdect") {
            createdDevs = createdDevs.concat(await this.create_fritzdect(srcInstId, yahkaDst));
          } else if (adapter === "rpi-io") {
            createdDevs = createdDevs.concat(await this.create_by_role(srcInstId, yahkaDst));
          } else if (adapter === "shelly") {
            createdDevs = createdDevs.concat(await this.create_shelly(srcInstId, yahkaDst));
          } else if (adapter === "switchboard-io") {
            createdDevs = createdDevs.concat(await this.create_by_role(srcInstId, yahkaDst));
          } else if (adapter === "tr-064") {
            createdDevs = createdDevs.concat(await this.create_tr064(srcInstId, yahkaDst));
          } else if (adapter === "zigbee2mqtt") {
            createdDevs = createdDevs.concat(await this.create_zigbee2mqtt(srcInstId, yahkaDst));
          }
        }
        for (const createdDev of createdDevs) {
          Object.assign(createdDev, Object.assign({
            "configType": "customdevice",
            "manufacturer": "n/a",
            // visible within iOS home app
            "model": "n/a",
            // visible within iOS home app
            "serial": "n/a",
            // visible within iOS home app
            "firmware": "n/a",
            // visible within iOS home app
            "enabled": true
          }, createdDev));
          for (const service of createdDev.services) {
            for (const characteristic of service.characteristics) {
              characteristic.enabled = true;
            }
          }
        }
        const newDevs = [];
        for (const oldDev of oldDevs) {
          const createdDev = createdDevs.find((createdDev2) => createdDev2.name === oldDev.name);
          if (createdDev) {
            createdDev.enabled = (_b = oldDev.enabled) != null ? _b : false;
            if (!createdDev.enabled) {
              createdDev.groupString = "~disabled~";
              this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s", "createYahkaConfig()", "disabled", createdDev.name));
            }
            newDevs.push(createdDev);
          } else {
            newDevs.push(Object.assign({}, oldDev, {
              enabled: false,
              groupString: "~obsolete~"
            }));
            this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s", "createYahkaConfig()", "obsolete", oldDev.name));
          }
        }
        for (const createdDev of createdDevs) {
          if (!oldDevs.find((oldDev) => oldDev.name === createdDev.name)) {
            newDevs.push(createdDev);
            this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s", "createYahkaConfig()", "added", createdDev.name));
          }
        }
        const diffs = (0, import_deep_diff.diff)(oldDevs, newDevs);
        for (const diff of diffs != null ? diffs : []) {
          if (diff.path) {
            const pathStr = diff.path.map((val) => typeof val === "number" ? `[${String(val)}]` : `.${String(val)}`).join("");
            if (diff.kind === "N") {
              this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s %s", "createYahkaConfig()", "added", pathStr, JSON.stringify(diff.rhs)));
            } else if (diff.kind === "D") {
              this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s %s", "createYahkaConfig()", "deleted", pathStr, JSON.stringify(diff.lhs)));
            } else if (diff.kind === "E") {
              this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s %-20s --> %-10s", "createYahkaConfig()", "edited", pathStr, JSON.stringify(diff.lhs), JSON.stringify(diff.rhs)));
            } else {
              this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-30s %s", "createYahkaConfig()", "changed", pathStr, JSON.stringify(diff.item)));
            }
          }
        }
        if (diffs) {
          this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", dstId, "saving yahka devices ...", ""));
          if (yahkaDst.native["bridge"]) {
            yahkaDst.native["bridge"]["devices"] = newDevs;
            await this.setForeignObject("system.adapter." + dstId, yahkaDst);
          }
        }
      }
    }
    this.terminate("yahka config updated. adapter stopped until next scheduled moment");
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   * @returns
   */
  async create_tr064(srcInstId, _yahkaDstApt) {
    var _a;
    const accConfigs = [];
    const stateObjs = await this.getForeignObjectsAsync(`${srcInstId}.states.*`, "state");
    for (const state of Object.values(stateObjs).sort((0, import_io_util.sortBy)("_id"))) {
      const idPath = state._id.split(".");
      if (state.common.type === "boolean" && !["wlan", "wlan24", "wlan50"].includes((_a = idPath.slice(-1)[0]) != null ? _a : "")) {
        const accConfig = {
          "category": AccCatId.Switch,
          "name": state._id,
          // NOTE: yahka adapter uses 'name' to build homekit UUID!
          "manufacturer": idPath.slice(0, 2).join("."),
          // visible within iOS home app
          "serial": idPath.slice(2).join("."),
          // visible within iOS home app
          "model": typeof state.common.name === "string" ? state.common.name : state.common.name.en,
          // visible within iOS home app
          "services": [],
          "groupString": idPath.slice(0, 2).join(".")
          // used by adapter only
        };
        accConfigs.push(accConfig);
        const accService = {
          "type": "Switch",
          "subType": "",
          "name": accConfig.model,
          "characteristics": [
            { "name": "Name", "inOutFunction": "const", "inOutParameters": accConfig.model },
            { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": state._id }
          ]
        };
        accConfig.services.push(accService);
        this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_tr064()", accService.type, accConfig.name, accService.name));
      }
    }
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   * @returns
   */
  async create_fritzdect(srcInstId, _yahkaDstApt) {
    var _a, _b, _c;
    const accConfigs = [];
    const channels = await this.getForeignObjectsAsync(`${srcInstId}.*`, "channel");
    for (const channel of Object.values(channels)) {
      const productname = await this.getForeignStateAsync(`${channel._id}.productname`);
      if (productname) {
        let accCategory = "";
        let srvType = "";
        const characteristics = [];
        if (productname.val === "FRITZ!DECT Repeater 100") {
          accCategory = AccCatId.Sensor;
          srvType = "TemperatureSensor";
          characteristics.push({
            "name": "CurrentTemperature",
            "inOutFunction": "ioBroker.State.OnlyACK",
            "inOutParameters": `${channel._id}.celsius`
          });
          await this.enableHistory(`${channel._id}.celsius`);
        } else if (productname.val === "FRITZ!Smart Energy 200") {
          accCategory = AccCatId.Switch;
          srvType = "Switch";
          characteristics.push({
            "name": "On",
            "inOutFunction": "ioBroker.State.OnlyACK",
            "inOutParameters": `${channel._id}.state`
          });
          await this.enableHistory(`${channel._id}.state`);
        } else if (productname.val === "FRITZ!Smart Thermo 301") {
          accCategory = AccCatId.Thermostat;
          srvType = "Thermostat";
          characteristics.push(
            { "name": "TemperatureDisplayUnits", "inOutFunction": "const", "inOutParameters": "0" },
            { "name": "TargetTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": channel._id + ".tsoll" },
            { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": channel._id + ".tist" },
            { "name": "TargetHeatingCoolingState", "inOutFunction": "const", "inOutParameters": 3 },
            { "name": "CurrentHeatingCoolingState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": channel._id + ".heatingCoolingState" }
          );
          await this.enableHistory(`${channel._id}.tsoll`);
          await this.enableHistory(`${channel._id}.tist`);
        } else {
          this.log.error((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "create_fritzdect()", "unknown", "productname", productname.val));
        }
        if (!accCategory) {
          this.log.error((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_fritzdect()", "missing", "accCategory", productname.val));
        } else if (!srvType) {
          this.log.error((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_fritzdect()", "missing", "srvType", productname.val));
        } else {
          const idPath = channel._id.split(".");
          const grpName = idPath.slice(0, 2).join(".");
          const nameObj = await this.getForeignStateAsync(`${channel._id}.name`);
          const devName = typeof (nameObj == null ? void 0 : nameObj.val) === "string" ? nameObj.val : "unknown";
          characteristics.push({
            "name": "Name",
            "inOutFunction": "const",
            "inOutParameters": devName
          });
          const manufacturer = await this.getForeignStateAsync(`${channel._id}.manufacturer`);
          const fwVersion = await this.getForeignStateAsync(`${channel._id}.fwversion`);
          const accConfig = {
            "category": accCategory,
            "groupString": grpName,
            // used by adapter only
            "name": channel._id,
            // NOTE: yahka adapter uses 'name' to build homekit UUID!
            "manufacturer": String((_a = manufacturer == null ? void 0 : manufacturer.val) != null ? _a : "n/a"),
            // visible within iOS home app
            "model": devName,
            // visible within iOS home app
            "firmware": String((_b = fwVersion == null ? void 0 : fwVersion.val) != null ? _b : "n/a"),
            // visible within iOS home app
            "serial": (_c = idPath[2]) != null ? _c : "",
            // visible within iOS home app
            "services": []
          };
          accConfigs.push(accConfig);
          const accService = {
            "type": srvType,
            "subType": "",
            "name": devName,
            "characteristics": characteristics
          };
          accConfig.services.push(accService);
          this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_fritzdect()", accService.type, accConfig.name, accService.name));
        }
      }
    }
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   * @returns
   */
  async create_shelly(srcInstId, _yahkaDstApt) {
    var _a;
    const accConfigs = [];
    const lightChannels = await this.getForeignObjectsAsync(`${srcInstId}.*.lights`, "channel");
    const relayChannels = await this.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, "channel");
    const channels = Object.values(lightChannels).concat(Object.values(relayChannels)).sort((0, import_io_util.sortBy)("_id"));
    for (const channel of channels) {
      const idPath = channel._id.split(".");
      const name = typeof channel.common.name === "string" ? channel.common.name : channel.common.name.en;
      let accCategory = "";
      let srvType = "";
      const characteristics = [];
      if (((_a = idPath[3]) != null ? _a : "").startsWith("Relay")) {
        accCategory = AccCatId.Switch;
        srvType = "Switch";
        characteristics.push({
          "name": "On",
          "inOutFunction": "ioBroker.State.OnlyACK",
          "inOutParameters": `${channel._id}.Switch`
        });
      } else if (idPath[3] === "lights") {
        accCategory = AccCatId.Lightbulb;
        srvType = "Lightbulb";
        characteristics.push({
          "name": "On",
          "inOutFunction": "ioBroker.State.OnlyACK",
          "inOutParameters": `${channel._id}.Switch`
        });
        characteristics.push({
          "name": "Brightness",
          "inOutFunction": "ioBroker.State.OnlyACK",
          "inOutParameters": `${channel._id}.brightness`
        });
      }
      if (accCategory && srvType) {
        characteristics.push({
          "name": "Name",
          "inOutFunction": "const",
          "inOutParameters": name
        });
        const accConfig = {
          "groupString": srcInstId,
          // used by adapter only
          "name": name,
          // NOTE: yahka adapter uses 'name' to build homekit UUID!
          "category": accCategory,
          "manufacturer": "shelly",
          // visible within iOS home app
          "serial": idPath.slice(2, 4).join("."),
          // visible within iOS home app
          "availableState": `${idPath.slice(0, 3).join(".")}.online`,
          "services": []
        };
        accConfigs.push(accConfig);
        const accService = {
          "type": srvType,
          "subType": "",
          "name": name,
          "characteristics": characteristics
        };
        accConfig.services.push(accService);
        this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_shelly()", accService.type, accConfig.name, accService.name));
      }
    }
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   */
  async create_by_role(srcInstId, _yahkaDstApt) {
    const accConfigs = [];
    const pinObjs = await this.getForeignObjectsAsync(`${srcInstId}.*`, "state");
    for (const pinObj of Object.values(pinObjs).sort((0, import_io_util.sortBy)("_id"))) {
      const objId = pinObj._id;
      const idPath = pinObj._id.split(".");
      const objRole = pinObj.common.role;
      const objName = typeof pinObj.common.name === "string" ? pinObj.common.name : pinObj.common.name.en;
      const accConfig = {
        "category": "",
        "name": objId,
        // NOTE: yahka adapter uses 'name' to build homekit UUID!
        "manufacturer": idPath.slice(0, 2).join("."),
        // visible within iOS home app
        "serial": idPath.slice(2).join("."),
        // visible within iOS home app
        "model": objName,
        // visible within iOS home app
        "services": [],
        // default
        "groupString": idPath.slice(0, 2).join(".")
        // used by adapter only
      };
      if (objRole === "sensor.contact") {
        accConfig.category = AccCatId.Sensor;
        accConfig.services = [
          {
            "type": "ContactSensor",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "ContactSensorState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (objRole === "sensor.motion") {
        accConfig.category = AccCatId.Sensor;
        accConfig.services = [
          {
            "type": "MotionSensor",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "MotionDetected", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (objRole === "sensor.occupancy") {
        accConfig.category = AccCatId.Sensor;
        accConfig.services = [
          {
            "type": "OccupancySensor",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "OccupancyDetected", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (objRole === "sensor.leak") {
        accConfig.category = AccCatId.Sensor;
        accConfig.services = [
          {
            "type": "LeakSensor",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "LeakDetected", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (objRole === "switch") {
        accConfig.category = AccCatId.Switch;
        accConfig.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (objRole === "switch.light") {
        accConfig.category = AccCatId.Lightbulb;
        accConfig.services = [
          {
            "type": "Lightbulb",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (objRole === "switch.lock.door") {
        accConfig.category = AccCatId.Door_lock;
        accConfig.services = [
          {
            "type": "LockMechanism",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "LockTargetState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId, "conversionFunction": "invert" },
              { "name": "LockCurrentState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId + "_status", "conversionFunction": "invert" }
            ]
          }
        ];
      } else if (objRole === "switch.garage") {
        accConfig.category = AccCatId.Garage_door_opener;
        accConfig.services = [
          {
            "type": "GarageDoorOpener",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "TargetDoorState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId, "conversionFunction": "invert" },
              { "name": "CurrentDoorState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId + "_status", "conversionFunction": "invert" },
              { "name": "ObstructionDetected", "inOutFunction": "const", "inOutParameters": false }
            ]
          }
        ];
      } else if (objRole === "switch.fan") {
        accConfig.category = AccCatId.Fan;
        accConfig.services = [
          {
            "type": "Fan",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      }
      if (accConfig.services.length > 0) {
        accConfigs.push(accConfig);
        for (const accService of accConfig.services) {
          this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_by_role()", accService.type, accConfig.name, accService.name));
        }
      }
    }
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   */
  async create_danfoss(srcInstId, _yahkaDstApt) {
    const accConfigs = [];
    const group = srcInstId;
    const housePause = await this.getForeignObjectAsync(`${srcInstId}.House.HousePause`);
    if (housePause) {
      const idPath = housePause._id.split(".");
      const name = typeof housePause.common.name === "string" ? housePause.common.name : housePause.common.name.en;
      const accConfig = {
        "groupString": group,
        // used only by iobroker adapter to group accessiries
        "name": housePause._id,
        // NOTE: yahka adapter uses 'name' to build homekit UUID!
        "manufacturer": group,
        // visible within iOS home app
        "model": name,
        // visible within iOS home app
        "serial": idPath.slice(2).join("."),
        // visible within iOS home app
        "category": AccCatId.Switch,
        "services": []
      };
      const accService = {
        "type": "Switch",
        "subType": "",
        "name": accConfig.model,
        "characteristics": [
          { "name": "Name", "inOutFunction": "const", "inOutParameters": name },
          { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": housePause._id }
        ]
      };
      accConfig.services.push(accService);
      accConfigs.push(accConfig);
      this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_danfoss()", accService.type, accConfig.name, accService.name));
    }
    const targetTemps = await this.getForeignObjectsAsync(`${srcInstId}.room-*.TargetTemp`, "state");
    for (const targetTempObj of Object.values(targetTemps).sort((0, import_io_util.sortBy)("_id"))) {
      const idPath = targetTempObj._id.split(".");
      const idBase = idPath.slice(0, -1).join(".");
      const name = typeof targetTempObj.common.name === "string" ? targetTempObj.common.name : targetTempObj.common.name.en;
      const accConfig = {
        "category": AccCatId.Thermostat,
        "name": targetTempObj._id,
        // NOTE: yahka adapter uses 'name' to build homekit UUID!
        "manufacturer": group,
        // visible within iOS home app
        "serial": idPath.slice(2).join("."),
        // visible within iOS home app
        "model": name,
        // visible within iOS home app
        "services": [],
        "groupString": group,
        // used by adapter only
        "availableState": `${group}.House.PeerConnected`
      };
      accConfigs.push(accConfig);
      const accService = {
        "type": "Thermostat",
        "subType": "",
        "name": name,
        "characteristics": [
          { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": name },
          { "name": "TargetTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": idBase + ".TargetTemp" },
          { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": idBase + ".RoomTemp" },
          { "name": "TemperatureDisplayUnits", "inOutFunction": "const", "inOutParameters": "0" },
          { "name": "TargetHeatingCoolingState", "inOutFunction": "const", "inOutParameters": "3" },
          {
            "name": "CurrentHeatingCoolingState",
            "inOutFunction": "ioBroker.State.OnlyACK",
            "inOutParameters": idBase + ".ValveState",
            "conversionFunction": "script",
            "conversionParameters": { "toHomeKit": "return (value) ? 1 : 2;", "toIOBroker": "return (value == 1);" }
          }
          // TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
        ]
        // CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
      };
      accConfig.services.push(accService);
      this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_danfoss()", accService.type, accConfig.name, accService.name));
    }
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   * @returns
   */
  async create_zigbee2mqtt(srcInstId, _yahkaDstApt) {
    var _a;
    const accConfigs = [];
    const zigbeeDevs = await new Promise((resolve, _reject) => {
      const client = import_mqtt.default.connect("mqtt://127.0.0.1:1883");
      client.on("connect", (_pkt) => {
        client.on("message", (_topic, payload, _pkt2) => {
          client.end();
          resolve(JSON.parse(payload.toString()));
        }).subscribe("zigbee2mqtt/bridge/devices");
      });
    });
    const iobDevs = await this.getForeignObjectsAsync(`${srcInstId}.*`, "device");
    for (const iobDev of Object.values(iobDevs)) {
      const idPath = iobDev._id.split(".");
      const ieeeAdr = idPath.slice(-1)[0];
      const zigbeeDev = zigbeeDevs.find((dev) => dev.ieee_address === ieeeAdr);
      if (zigbeeDev) {
        const { ieee_address, network_address, supported, friendly_name, disabled, definition, software_build_id, model_id, interviewing, interview_completed, manufacturer, endpoints } = zigbeeDev;
        if (typeof ieee_address !== "string") {
          throw new Error("device ieee_address must be string");
        }
        if (typeof network_address !== "number") {
          throw new Error("device network_address must be number");
        }
        if (typeof supported !== "boolean") {
          throw new Error("device supported must be boolean");
        }
        if (typeof friendly_name !== "string") {
          throw new Error("device friendly_name must be string");
        }
        if (typeof disabled !== "boolean") {
          throw new Error("device disabled must be boolean");
        }
        if (typeof definition !== "object") {
          throw new Error("device definition must be object");
        }
        if (typeof model_id !== "string") {
          throw new Error("device model_id must be string");
        }
        if (typeof interviewing !== "boolean") {
          throw new Error("device interviewing must be boolean");
        }
        if (typeof interview_completed !== "boolean") {
          throw new Error("device interview_completed must be boolean");
        }
        if (typeof manufacturer !== "string") {
          throw new Error("device manufacturer must be string");
        }
        if (typeof endpoints !== "object") {
          throw new Error("device endpoints must be object");
        }
        const { model, vendor, description, exposes, supports_ota, options } = zigbeeDev.definition;
        if (typeof model !== "string") {
          throw new Error("definition model must be string");
        }
        if (typeof vendor !== "string") {
          throw new Error("definition vendor must be string");
        }
        if (typeof description !== "string") {
          throw new Error("definition description must be string");
        }
        if (typeof exposes !== "object") {
          throw new Error("definition exposes must be object");
        }
        if (typeof supports_ota !== "boolean") {
          throw new Error("definition supports_ota must be boolean");
        }
        if (typeof options !== "object") {
          throw new Error("definition options must be object");
        }
        const checkFeature = (feature) => {
          const { access, label, name, type } = feature;
          if (typeof access !== "number") {
            throw new Error("feature access must be number");
          }
          if (typeof label !== "string") {
            throw new Error("feature label must be string");
          }
          if (typeof name !== "string") {
            throw new Error("feature name must be string");
          }
          if (!["binary", "numeric", "enum", "composite"].includes(type)) {
            throw new Error(`invalid feature type ${type}`);
          }
        };
        for (const expose of exposes) {
          if (["light", "composite"].includes(expose.type) && Array.isArray(expose.features)) {
            for (const feature of expose.features) {
              checkFeature(feature);
            }
          } else {
            checkFeature(expose);
          }
        }
        const grpName = idPath.slice(0, 2).join(".");
        const devName = friendly_name;
        const accConfig = {
          "groupString": grpName,
          // used only by iobroker adapter to group accessiries
          "name": `${grpName}.${devName}`,
          // NOTE: yahka adapter uses 'name' to build homekit UUID!
          "model": devName,
          // visible within iOS home app
          "manufacturer": `${vendor} ${model_id} (${model})`,
          // visible within iOS home app
          "serial": ieee_address,
          // visible within iOS home app
          "firmware": software_build_id != null ? software_build_id : "n/a",
          // visible within iOS home app
          "category": "",
          // accCatIds[expose.type]
          "services": [],
          "availableState": `${iobDev._id}.available`
        };
        const features = exposes.filter((expose) => "name" in expose);
        const featureNames = features.map((feature) => feature.name);
        const typedFeatures = exposes.filter((expose) => "features" in expose);
        const exposedLight = typedFeatures.find((expose) => expose.type === "light");
        if (exposedLight) {
          const characteristics = [];
          for (const feature of (_a = exposedLight.features) != null ? _a : []) {
            if (feature.name === "state") {
              characteristics.push({
                "name": "On",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.state`
              });
            } else if (feature.name === "brightness") {
              characteristics.push({
                "name": "Brightness",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.brightness`
              });
            } else if (feature.name === "color_temp") {
              characteristics.push({
                "name": "ColorTemperature",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.colortemp`,
                "conversionFunction": "script",
                "conversionParameters": {
                  "toHomeKit": "return Math.max(153, value)",
                  "toIOBroker": "return Math.max(153, value)"
                }
              });
            }
          }
          accConfig.category = AccCatId.Lightbulb;
          accConfig.services.push({
            "type": "Lightbulb",
            "subType": "",
            "name": devName,
            "characteristics": characteristics
          });
        } else if (featureNames.includes("contact")) {
          accConfig.category = AccCatId.Sensor;
          for (const feature of features) {
            if (feature.name === "contact") {
              const characteristics = [{
                "name": "ContactSensorState",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.opened`
              }];
              accConfig.services.push({
                "type": "ContactSensor",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
            if (feature.name === "battery") {
              const characteristics = [
                {
                  "name": "BatteryLevel",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`
                },
                {
                  "name": "StatusLowBattery",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`,
                  "conversionFunction": "script",
                  "conversionParameters": { "toHomeKit": "return (value < 10);" }
                }
              ];
              accConfig.services.push({
                "type": "Battery",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
          }
        } else if (featureNames.includes("water_leak")) {
          accConfig.category = AccCatId.Sensor;
          for (const feature of features) {
            if (feature.name === "water_leak") {
              const characteristics = [{
                "name": "LeakDetected",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.detected`
              }];
              accConfig.services.push({
                "type": "LeakSensor",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
            if (feature.name === "battery") {
              const characteristics = [
                {
                  "name": "BatteryLevel",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`
                },
                {
                  "name": "StatusLowBattery",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`,
                  "conversionFunction": "script",
                  "conversionParameters": { "toHomeKit": "return (value < 10);" }
                }
              ];
              accConfig.services.push({
                "type": "Battery",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
          }
        } else if (featureNames.includes("occupancy")) {
          accConfig.category = AccCatId.Sensor;
          for (const feature of features) {
            if (feature.name === "occupancy") {
              const characteristics = [{
                "name": "OccupancyDetected",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.occupancy`
              }];
              accConfig.services.push({
                "type": "OccupancySensor",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
            if (feature.name === "battery") {
              const characteristics = [
                {
                  "name": "BatteryLevel",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`
                },
                {
                  "name": "StatusLowBattery",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`,
                  "conversionFunction": "script",
                  "conversionParameters": { "toHomeKit": "return (value < 10);" }
                }
              ];
              accConfig.services.push({
                "type": "Battery",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
          }
        } else if (featureNames.includes("humidity")) {
          accConfig.category = AccCatId.Sensor;
          for (const feature of features) {
            if (feature.name === "humidity") {
              const characteristics = [{
                "name": "CurrentRelativeHumidity",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.humidity`
              }];
              accConfig.services.push({
                "type": "HumiditySensor",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
            if (feature.name === "temperature") {
              const characteristics = [{
                "name": "CurrentTemperature",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.temperature`
              }];
              accConfig.services.push({
                "type": "TemperatureSensor",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
            if (feature.name === "battery") {
              const characteristics = [
                {
                  "name": "BatteryLevel",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`
                },
                {
                  "name": "StatusLowBattery",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${iobDev._id}.battery`,
                  "conversionFunction": "script",
                  "conversionParameters": { "toHomeKit": "return (value < 10);" }
                }
              ];
              accConfig.services.push({
                "type": "Battery",
                "subType": "",
                "name": devName,
                "characteristics": characteristics
              });
            }
          }
        }
        for (const featureName of ["linkquality", "opened", "detected", "battery", "battery_low", "device_temperature", "voltage"]) {
          if (featureNames.includes(featureName)) {
            const stateName = featureName === "linkquality" ? "link_quality" : featureName;
            await this.enableHistory(`${iobDev._id}.${stateName}`);
          }
        }
        await this.enableHistory(`${iobDev._id}.available`);
        if (accConfig.category !== "") {
          for (const accService of accConfig.services) {
            accService.characteristics.push({
              "name": "Name",
              "inOutFunction": "const",
              "inOutParameters": devName
            });
            this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_zigbee2mqtt()", accService.type, accConfig.name, accService.name));
          }
          accConfigs.push(accConfig);
        }
      }
    }
    return accConfigs;
  }
  /**
   *
   * @param stateId
   */
  async enableHistory(stateId) {
    var _a;
    if (this.historyId) {
      const stateObj = await this.getForeignObjectAsync(stateId);
      if ((stateObj == null ? void 0 : stateObj.type) === "state") {
        const { type, common, native } = stateObj;
        common.custom = (_a = common.custom) != null ? _a : {};
        common.custom[this.historyId] = Object.assign(
          {
            // defaults
            "enabled": true,
            "changesRelogInterval": 0,
            "retention": 0,
            "changesOnly": false
          },
          common.custom[this.historyId],
          {
            // overrides
            "changesOnly": false
          }
        );
        await this.setForeignObject(stateId, { type, common, native });
      } else {
        this.log.warn((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "enableHistory()", "missing", stateId));
      }
    }
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  onUnload(callback) {
    callback();
  }
}
if (require.main !== module) {
  module.exports = (options) => new YahkaConfig(options);
} else {
  (() => new YahkaConfig())();
}
//# sourceMappingURL=main.js.map
