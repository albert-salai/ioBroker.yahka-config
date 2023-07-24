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
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var utils = __toESM(require("@iobroker/adapter-core"));
var import_io_package = __toESM(require("iobroker.yahka/io-package.json"));
var import_sprintf_js = require("sprintf-js");
const AccCatId = Object.entries(import_io_package.default.objects[0].native).reduce((result, [key, val]) => {
  result[val.text.replace(/ /g, "_")] = key;
  return result;
}, {});
class YahkaConfig extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: "yahka-config"
    });
    this.on("ready", this.onReady.bind(this));
    this.on("unload", this.onUnload.bind(this));
  }
  async onReady() {
    const mapping = this.config.mapping;
    this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "onReady()", "mapping", "\n" + JSON.stringify(mapping, null, 4)));
    for (const [dstId, srcIdsObj] of Object.entries(mapping)) {
      const srcIds = Object.entries(srcIdsObj).filter((entry) => entry[1] === true).map((entry) => entry[0]).sort();
      const yahkaDstApt = await this.getForeignObjectAsync("system.adapter." + dstId);
      if (!yahkaDstApt) {
        this.log.warn((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "onReady()", "system.adapter." + dstId, "not installed"));
        delete mapping[dstId];
      } else {
        await this.createYahkaConfig(yahkaDstApt, srcIds);
      }
    }
  }
  onUnload(callback) {
    try {
    } finally {
      callback();
    }
  }
  async createYahkaConfig(yahkaDstApt, srcInsts) {
    const yahkaAptId = yahkaDstApt._id;
    this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s\n%s", "createYahkaConfig()", yahkaAptId, JSON.stringify(srcInsts, null, 4)));
    let iobSrcObjs = [];
    for (let srcInst of srcInsts) {
      srcInst += ".*";
      const stateObjs = await this.getForeignObjectsAsync(srcInst, "state") || {};
      const stateRegEx = new RegExp(srcInst.replace(/\./g, "\\.").replace(/\*/g, "[^\\.]*"));
      const statesArr = Object.values(stateObjs).filter((obj) => obj._id.match(stateRegEx) !== null);
      this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "createYahkaConfig()", "#" + statesArr.length, stateRegEx));
      iobSrcObjs = iobSrcObjs.concat(statesArr);
    }
    iobSrcObjs.sort((obj1, obj2) => obj1._id > obj2._id ? 1 : obj1._id < obj2._id ? -1 : 0);
    const yahkaNewDevs = await this.createYahkaDevs(iobSrcObjs);
    const yahkaOldDevs = yahkaDstApt["native"]["bridge"]["devices"];
    for (const yahkaNewDev of yahkaNewDevs) {
      const yahkaOldDev = yahkaOldDevs.find((oldDev) => oldDev.name === yahkaNewDev.name);
      yahkaNewDev.enabled = yahkaOldDev ? yahkaOldDev.enabled : true;
    }
    let yahkaChanged = false;
    for (const yahkaOldDev of yahkaOldDevs) {
      const keep = !yahkaNewDevs.some((newDev) => newDev.name === yahkaOldDev.name);
      if (keep) {
        this.log.warn((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "createYahkaConfig()", "keeping", yahkaOldDev.name, ""));
        yahkaNewDevs.push(yahkaOldDev);
      }
    }
    yahkaOldDevs.sort(sortBy("name"));
    yahkaNewDevs.sort(sortBy("name"));
    const diff = objDiff(yahkaOldDevs, yahkaNewDevs, "yahkaDevs");
    yahkaChanged = yahkaChanged || Object.values(diff).length > 0;
    if (Object.values(diff).length > 0) {
      this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "createYahkaConfig()", yahkaAptId, "diff", "\n" + JSON.stringify(diff, null, 4)));
    }
    if (yahkaChanged) {
      this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "createYahkaConfig()", yahkaAptId, "saving yahka devices ...", ""));
      yahkaDstApt["native"]["bridge"]["devices"] = yahkaNewDevs;
      await this.setForeignObjectAsync(yahkaAptId, yahkaDstApt);
    }
  }
  async createYahkaDevs(iobSrcObjs) {
    this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "createYahkaDevs()", "#" + iobSrcObjs.length, "..."));
    const yahkaNewDevs = [];
    if (!Array.isArray(iobSrcObjs)) {
      this.log.warn((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "createYahkaDevs()", "iobSrcObjs is not an arrray", "", ""));
    } else {
      for (const iobSrcObj of iobSrcObjs) {
        const yahkaNewDev = await this.createYahkaDev(iobSrcObj);
        if (yahkaNewDev) {
          yahkaNewDevs.push(yahkaNewDev);
        }
      }
    }
    this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "createYahkaDevs()", "#" + iobSrcObjs.length, "done."));
    return yahkaNewDevs;
  }
  async createYahkaDev(iobSrcObj) {
    const objRole = iobSrcObj.common.role;
    const objName = iobSrcObj.common.name;
    const objValType = iobSrcObj.common.type;
    const objId = iobSrcObj._id;
    const idPath = objId.split(".");
    const idBase = idPath.slice(0, -1).join(".");
    const idLeaf = idPath.slice(-1)[0];
    const devCfg = {
      "configType": "customdevice",
      "name": objId,
      "manufacturer": idPath.slice(0, 2).join("."),
      "serial": idPath.slice(2).join("."),
      "model": "?",
      "firmware": "?",
      "category": "?",
      "services": [],
      "enabled": true
    };
    if (idPath[0] === "danfoss-icon") {
      if (idLeaf === "HousePause") {
        devCfg.model = "danfoss-icon";
        devCfg.firmware = "";
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": objName,
            "characteristics": [
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (idLeaf === "TargetTemp") {
        const nameId = `${idBase}.RoomName`;
        const nameStr = (await this.getForeignStateAsync(nameId) || {}).val || "?";
        devCfg.category = AccCatId.Thermostat;
        devCfg.services = [
          {
            "type": "Thermostat",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": nameId },
              { "name": "TargetTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": idBase + ".TargetTemp" },
              { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": idBase + ".RoomTemp" },
              { "name": "TemperatureDisplayUnits", "inOutFunction": "const", "inOutParameters": "0" },
              { "name": "TargetHeatingCoolingState", "inOutFunction": "const", "inOutParameters": "3" },
              {
                "name": "CurrentHeatingCoolingState",
                "inOutFunction": "ioBroker.State",
                "inOutParameters": idBase + ".ValveState",
                "conversionFunction": "script",
                "conversionParameters": { "toHomeKit": "return (value) ? 1 : 2;", "toIOBroker": "return (value == 1);" }
              }
            ]
          }
        ];
      }
    } else if (idPath[0] === "openweathermap" && idPath[3] === "current") {
      const nameStr = objName.split(".").join(" ");
      devCfg.model = idPath.slice(2).join(".");
      if (idLeaf === "temperature") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
          {
            "type": "TemperatureSensor",
            "subType": "",
            "name": nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": nameStr },
              { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (idLeaf === "humidity") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
          {
            "type": "HumiditySensor",
            "subType": "",
            "name": nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": nameStr },
              { "name": "CurrentRelativeHumidity", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      }
    } else if (idPath[0] === "shelly") {
      const nameId = `${idBase}.ChannelName`;
      const nameStr = (await this.getForeignStateAsync(nameId) || {}).val || "?";
      devCfg.model = "" + (await this.getForeignStateAsync(idPath.slice(0, -2).join(".") + ".type") || { val: "?" }).val;
      devCfg.firmware = "" + (await this.getForeignStateAsync(idPath.slice(0, -2).join(".") + ".version") || { val: "?" }).val;
      if (idLeaf === "brightness") {
        devCfg.category = AccCatId.Lightbulb;
        devCfg.services = [
          {
            "type": "Lightbulb",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": nameId },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.Switch` },
              { "name": "Brightness", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.brightness` }
            ]
          }
        ];
      } else if (idLeaf === "Switch" && idPath[3].startsWith("Relay")) {
        devCfg.model = "" + (await this.getForeignStateAsync(idPath.slice(0, -2).join(".") + ".type") || { val: "?" }).val;
        devCfg.firmware = "" + (await this.getForeignStateAsync(idPath.slice(0, -2).join(".") + ".version") || { val: "?" }).val;
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": nameId },
              { "name": "On", "inOutFunction": "ioBroker.State", "inOutParameters": objId }
            ]
          }
        ];
      }
    } else if (idPath[0] === "sonoff" && ["POWER1", "POWER2", "SI7021_Temperature", "SI7021_Humidity"].indexOf(idLeaf) >= 0) {
      const nameStr = (await this.getForeignStateAsync(`${idBase}.DeviceName`) || {}).val || "?";
      devCfg.model = "" + (await this.getForeignStateAsync(`${idBase}.INFO.Info1_Module`) || {}).val || "?";
      devCfg.firmware = "" + (await this.getForeignStateAsync(`${idBase}.INFO.Info1_Version`) || {}).val || "?";
      if (["POWER1", "POWER2"].indexOf(idLeaf) >= 0) {
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State", "inOutParameters": `${idBase}.DeviceName` },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (idLeaf === "SI7021_Temperature") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
          {
            "type": "TemperatureSensor",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State", "inOutParameters": `${idBase}.DeviceName` },
              { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      } else if (idLeaf === "SI7021_Humidity") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
          {
            "type": "HumiditySensor",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State", "inOutParameters": `${idBase}.DeviceName` },
              { "name": "CurrentRelativeHumidity", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      }
    } else if (idPath[0] === "kernel" && objRole === "switch") {
      devCfg.category = AccCatId.Switch;
      devCfg.services = [
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
    } else if (idPath[0] === "kernel" && objRole === "sensor.lux") {
      devCfg.category = AccCatId.Sensor;
      devCfg.services = [
        {
          "type": "LightSensor",
          "subType": "",
          "name": objName,
          "characteristics": [
            { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
            { "name": "CurrentAmbientLightLevel", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
          ]
        }
      ];
    } else if (idPath[0] === "fritzdect" && ["tsoll", "tist", "celsius"].includes(idLeaf)) {
      const nameStr = (await this.getForeignStateAsync(`${idBase}.name`) || {}).val || "?";
      devCfg.model = "" + (await this.getForeignStateAsync(`${idBase}.productname`) || {}).val || "?";
      devCfg.firmware = "" + (await this.getForeignStateAsync(`${idBase}.fwversion`) || {}).val || "?";
      if (devCfg.model === "FRITZ!DECT 301") {
        if (idLeaf === "tsoll") {
          devCfg.category = AccCatId.Thermostat;
          devCfg.services = [
            {
              "type": "Thermostat",
              "subType": "",
              "name": "" + nameStr,
              "characteristics": [
                { "name": "TemperatureDisplayUnits", "inOutFunction": "const", "inOutParameters": "0" },
                { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.name` },
                { "name": "TargetTemperature", "inOutFunction": "ioBroker.State", "inOutParameters": `${idBase}.tsoll` },
                { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.celsius` },
                { "name": "TargetHeatingCoolingState", "inOutFunction": "const", "inOutParameters": "3" },
                { "name": "CurrentHeatingCoolingState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.heatingCoolingState` }
              ]
            },
            {
              "type": "BatteryService",
              "subType": "",
              "name": "" + nameStr,
              "characteristics": [
                { "name": "ChargingState", "inOutFunction": "const", "inOutParameters": "2" },
                { "name": "BatteryLevel", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.battery` },
                {
                  "name": "StatusLowBattery",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${idBase}.battery`,
                  "conversionFunction": "script",
                  "conversionParameters": { "toHomeKit": "return (value <= 20);", "toIOBroker": "return false;" }
                }
              ]
            }
          ];
        } else if (idLeaf === "tist") {
          devCfg.category = AccCatId.Thermostat;
          devCfg.services = [
            {
              "type": "TemperatureSensor",
              "subType": "",
              "name": "" + nameStr,
              "characteristics": [
                { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.tist` }
              ]
            }
          ];
        }
      } else if (devCfg.model === "FRITZ!DECT 200" && idLeaf === "celsius") {
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State", "inOutParameters": `${idBase}.name` },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.state` }
            ]
          },
          {
            "type": "TemperatureSensor",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.celsius` }
            ]
          }
        ];
      } else if (devCfg.model === "FRITZ!DECT Repeater 100" && idLeaf === "celsius") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
          {
            "type": "TemperatureSensor",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.name` },
              { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.celsius` }
            ]
          }
        ];
      } else {
        this.log.warn((0, import_sprintf_js.sprintf)("%-15s %-25s %-45s %s", "ConfigureYahka", "createYahkaDev()", objId, "not implemented yet"));
      }
    } else if (idPath[0] === "tr-064" && idPath[2] == "states" && (objRole === "state" || objRole === "button")) {
      if (objValType === "boolean" && idLeaf !== "wlan") {
        const nameStr = objName || idLeaf + " " + devCfg.model;
        devCfg.model = idPath.slice(0, 2).join(".");
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": nameStr },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      }
    } else if (idPath[0] === "tr-064" && idPath[2] == "devices" && idLeaf == "active" && objRole === "state") {
      const nameStr = idPath[idPath.length - 2];
      devCfg.model = idPath.slice(0, 2).join(".");
      devCfg.category = AccCatId.Sensor;
      devCfg.services = [
        {
          "type": "OccupancySensor",
          "subType": "",
          "name": nameStr,
          "characteristics": [
            { "name": "Name", "inOutFunction": "const", "inOutParameters": nameStr },
            { "name": "OccupancyDetected", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
          ]
        }
      ];
    }
    for (const srv of devCfg.services) {
      for (const chr of srv.characteristics) {
        chr.enabled = true;
      }
    }
    if (devCfg.services.length > 0) {
      this.log.info((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s", "createYahkaDev()", "created", devCfg.name));
    }
    return devCfg.services.length > 0 ? devCfg : null;
  }
}
function sortBy(key) {
  return (a, b) => a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
}
function objDiff(oldObj, newObj, path = "", diff = {}) {
  if (oldObj === void 0) {
    diff[path] = { "new": newObj };
  } else if (newObj === void 0) {
    diff[path] = { "old": oldObj };
  } else if (Array.isArray(newObj)) {
    newObj.forEach((val, idx) => {
      objDiff(oldObj[idx], newObj[idx], path + "[" + idx + "]", diff);
    });
  } else if (newObj instanceof Object) {
    Object.keys(newObj).forEach((key) => {
      objDiff(oldObj[key], newObj[key], path + "." + key, diff);
    });
  } else if (!Object.is(oldObj, newObj)) {
    diff[path] = { "old": oldObj, "new": newObj };
  }
  return diff;
}
if (require.main !== module) {
  module.exports = (options) => new YahkaConfig(options);
} else {
  (() => new YahkaConfig())();
}
//# sourceMappingURL=main.js.map
