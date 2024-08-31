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
var import_io_package = __toESM(require("iobroker.yahka/io-package.json"));
var import_sprintf_js = require("sprintf-js");
var import_mqtt = __toESM(require("mqtt"));
const AccCatId = Object.entries(import_io_package.default.objects[0].native).reduce((result, [key, val]) => {
  result[val.text.replace(/ /g, "_")] = key;
  return result;
}, {});
class YahkaConfig extends utils.Adapter {
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
    const mapping = this.config.mapping;
    this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "onReady()", "mapping", "\n" + JSON.stringify(mapping, null, 4)));
    for (const [dstId, srcIdsObj] of Object.entries(mapping)) {
      const yahkaDst = await this.getForeignObjectAsync("system.adapter." + dstId);
      if (!yahkaDst) {
        this.log.warn((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "onReady()", "system.adapter." + dstId, "not installed"));
        delete mapping[dstId];
      } else {
        const yahkaOldDevs = yahkaDst["native"]["bridge"]["devices"];
        let yahkaNewDevs = [];
        const srcInstIds = Object.entries(srcIdsObj).filter((entry) => entry[1] === true).map((entry) => entry[0]).sort();
        for (const srcInstId of srcInstIds) {
          const adapter = srcInstId.split(".")[0];
          if (adapter === "tr-064") {
            yahkaNewDevs = yahkaNewDevs.concat(await this.create_tr064(srcInstId, yahkaDst));
          } else if (adapter === "fritzdect") {
            yahkaNewDevs = yahkaNewDevs.concat(await this.create_fritzdect(srcInstId, yahkaDst));
          } else if (adapter === "shelly") {
            yahkaNewDevs = yahkaNewDevs.concat(await this.create_shelly(srcInstId, yahkaDst));
          } else if (adapter === "0_userdata") {
            yahkaNewDevs = yahkaNewDevs.concat(await this.create_switchboard(srcInstId, yahkaDst));
          } else if (adapter === "zigbee2mqtt") {
            yahkaNewDevs = yahkaNewDevs.concat(await this.create_zigbee2mqtt(srcInstId, yahkaDst));
          } else if (adapter === "danfoss-icon") {
            yahkaNewDevs = yahkaNewDevs.concat(await this.create_danfoss(srcInstId, yahkaDst));
          }
        }
        for (const device of yahkaNewDevs) {
          Object.assign(yahkaNewDevs, {
            "firmware": "n/a"
            // visible within iOS home app
          }, yahkaNewDevs);
          for (const service of device.services) {
            for (const characteristic of service.characteristics) {
              characteristic.enabled = true;
            }
          }
        }
        yahkaOldDevs.sort(sortBy("name"));
        yahkaNewDevs.sort(sortBy("name"));
        for (const yahkaNewDev of yahkaNewDevs) {
          const yahkaOldDev = yahkaOldDevs.find((oldDev) => oldDev.name === yahkaNewDev.name);
          yahkaNewDev.enabled = yahkaOldDev ? yahkaOldDev.enabled : true;
        }
        let yahkaChanged = false;
        for (const yahkaOldDev of yahkaOldDevs) {
          const keep = !yahkaNewDevs.some((newDev) => newDev.name === yahkaOldDev.name);
          if (keep) {
            this.log.warn((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", "keeping", yahkaOldDev.name, ""));
            yahkaOldDev.enabled = false;
            yahkaNewDevs.push();
          }
        }
        const diff = objDiff(yahkaOldDevs, yahkaNewDevs, "yahkaDevs");
        yahkaChanged = yahkaChanged || Object.values(diff).length > 0;
        if (Object.values(diff).length > 0) {
          this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", dstId, "diff", "\n" + JSON.stringify(diff, null, 4)));
        }
        if (yahkaChanged) {
          this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", dstId, "saving yahka devices ...", ""));
          yahkaDst["native"]["bridge"]["devices"] = yahkaNewDevs;
          await this.setForeignObjectAsync("system.adapter." + dstId, yahkaDst);
        }
      }
    }
    this.terminate ? this.terminate("yahka config updated. adapter stopped until next scheduled moment") : process.exit(0);
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   * @returns
   */
  async create_tr064(srcInstId, _yahkaDstApt) {
    const accConfigs = [];
    const stateObjs = await this.getForeignObjectsAsync(`${srcInstId}.states.*`, "state") || {};
    for (const state of Object.values(stateObjs).sort(sortBy("_id"))) {
      const idPath = state._id.split(".");
      if (state.common.type === "boolean" && !["wlan", "wlan24", "wlan50"].includes(idPath.slice(-1)[0])) {
        this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "create_tr064()", "state", state._id, state.common.name));
        const accConfig = {
          "configType": "customdevice",
          "category": AccCatId.Switch,
          "name": state._id,
          // NOTE: yahka adapter uses 'name' to build homekit UUID!
          "manufacturer": idPath.slice(0, 2).join("."),
          // visible within iOS home app
          "serial": idPath.slice(2).join("."),
          // visible within iOS home app
          "model": state.common.name.toString(),
          // visible within iOS home app
          "services": [],
          "enabled": true,
          "groupString": idPath.slice(0, 2).join(".")
          // used by adapter only
        };
        accConfigs.push(accConfig);
        accConfig.services.push({
          "type": "Switch",
          "subType": "",
          "name": accConfig.model,
          "characteristics": [
            { "name": "Name", "inOutFunction": "const", "inOutParameters": accConfig.model },
            { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": state._id }
          ]
        });
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
    const accConfigs = [];
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   * @returns
   */
  async create_shelly(srcInstId, _yahkaDstApt) {
    const accConfigs = [];
    const lightChannels = await this.getForeignObjectsAsync(`${srcInstId}.*.lights`, "channel") || {};
    const relayChannels = await this.getForeignObjectsAsync(`${srcInstId}.*.Relay*`, "channel") || {};
    const channels = Object.values(lightChannels).concat(Object.values(relayChannels)).sort(sortBy("_id"));
    for (const channel of channels) {
      const idPath = channel._id.split(".");
      const name = channel.common.name.toString();
      let accCategory = "";
      let srvType = "";
      const characteristics = [];
      if (idPath[3].startsWith("Relay")) {
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
        this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_shelly()", `created ${idPath[3]}`, channel._id, channel.common.name));
        characteristics.push({
          "name": "Name",
          "inOutFunction": "const",
          "inOutParameters": name
        });
        const accConfig = {
          "configType": "customdevice",
          "enabled": true,
          "groupString": srcInstId,
          // used by adapter only
          "name": name,
          // NOTE: yahka adapter uses 'name' to build homekit UUID!
          "category": accCategory,
          "manufacturer": "shelly",
          // visible within iOS home app
          "serial": idPath[2],
          // visible within iOS home app
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
      }
    }
    return accConfigs;
  }
  /**
   *
   * @param srcInstId
   * @param _yahkaDstApt
   */
  async create_switchboard(srcInstId, _yahkaDstApt) {
    const accConfigs = [];
    const pinObjs = await this.getForeignObjectsAsync(`${srcInstId}.pin.*`, "state") || {};
    for (const pinObj of Object.values(pinObjs).sort(sortBy("_id"))) {
      const objId = pinObj._id;
      const idPath = pinObj._id.split(".");
      const objRole = pinObj.common.role;
      const objName = pinObj.common.name.toString();
      const accConfig = {
        "configType": "customdevice",
        // buggy: will not show up in iOS
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
        "enabled": true,
        "groupString": idPath.slice(0, 2).join(".")
        // used by adapter only
      };
      if (objRole === "door.lock") {
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
      } else if (objRole === "garage.opener") {
        accConfig.category = AccCatId.Door_lock;
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
      } else if (objRole === "switch.light") {
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
      } else if (objRole === "indicator") {
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
      } else {
        this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s ignored", "create_switchboard()", objRole, objId));
      }
      if (accConfig.services.length > 0) {
        this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_switchboard()", objRole, objId, pinObj.common.name));
        accConfigs.push(accConfig);
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
      const name = housePause.common.name.toString();
      const accConfig = {
        "configType": "customdevice",
        "category": AccCatId.Switch,
        "name": housePause._id,
        // NOTE: yahka adapter uses 'name' to build homekit UUID!
        "manufacturer": group,
        // visible within iOS home app
        "serial": idPath.slice(2).join("."),
        // visible within iOS home app
        "model": name,
        // visible within iOS home app
        "services": [],
        "enabled": true,
        "groupString": group
        // used by adapter only
      };
      accConfigs.push(accConfig);
      accConfig.services.push({
        "type": "Switch",
        "subType": "",
        "name": accConfig.model,
        "characteristics": [
          { "name": "Name", "inOutFunction": "const", "inOutParameters": name },
          { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": housePause._id }
        ]
      });
    }
    const targetTemps = await this.getForeignObjectsAsync(`${srcInstId}.room-*.TargetTemp`, "state");
    for (const targetTempObj of Object.values(targetTemps).sort(sortBy("_id"))) {
      this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_danfoss()", `TargetTemp`, targetTempObj._id, targetTempObj.common.name));
      const idPath = targetTempObj._id.split(".");
      const idBase = idPath.slice(0, -1).join(".");
      const name = targetTempObj.common.name.toString();
      const accConfig = {
        "configType": "customdevice",
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
        "enabled": true,
        "groupString": group
        // used by adapter only
      };
      accConfigs.push(accConfig);
      accConfig.services.push({
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
      });
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
    const accConfigs = [];
    const zigbeeDevs = await new Promise((resolve, _reject) => {
      const client = import_mqtt.default.connect("mqtt://127.0.0.1:1883");
      client.on("connect", (_pkt) => {
        client.on("message", (_topic, payload, _pkt2) => {
          resolve(JSON.parse(payload.toString()));
        }).subscribe("zigbee2mqtt/bridge/devices");
      });
    });
    const iobDevs = await this.getForeignObjectsAsync(`${srcInstId}.*`, "device");
    for (const iobDev of Object.values(iobDevs)) {
      const idPath = iobDev._id.split(".");
      const ieeeAdr = idPath.slice(-1)[0];
      const zigbeeDev = zigbeeDevs.find((dev) => dev.ieee_address === ieeeAdr);
      if (!zigbeeDev) {
        this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_zigbee2mqtt()", `skipped iobDev`, iobDev._id, iobDev.common.name));
      } else {
        let accCategory = "";
        let srvType = "";
        const characteristics = [];
        const features = zigbeeDev.definition.exposes.filter((expose) => "name" in expose);
        const typedFeatures = zigbeeDev.definition.exposes.filter((expose) => "features" in expose);
        const exposedLight = typedFeatures.filter((expose) => expose.type === "light")[0];
        if (exposedLight) {
          accCategory = AccCatId.Lightbulb;
          srvType = "Lightbulb";
          for (const feature of exposedLight.features) {
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
        } else if (features.find((feature) => feature.name === "contact")) {
          accCategory = AccCatId.Sensor;
          srvType = "ContactSensor";
          for (const feature of features) {
            if (feature.name === "contact") {
              characteristics.push({
                "name": "ContactSensorState",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.opened`
              });
            } else if (feature.name === "battery") {
              characteristics.push({
                "name": "StatusLowBattery",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.battery`,
                "conversionFunction": "script",
                "conversionParameters": { "toHomeKit": "return (value < 10);" }
              });
            }
          }
        } else if (features.find((feature) => feature.name === "water_leak")) {
          accCategory = AccCatId.Sensor;
          srvType = "LeakSensor";
          for (const feature of features) {
            if (feature.name === "water_leak") {
              characteristics.push({
                "name": "LeakDetected",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.detected`
              });
            } else if (feature.name === "battery") {
              characteristics.push({
                "name": "StatusLowBattery",
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": `${iobDev._id}.battery`,
                "conversionFunction": "script",
                "conversionParameters": { "toHomeKit": "return (value < 10);" }
              });
            }
          }
        } else if (typedFeatures.length > 0) {
          this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s\n%s", "create_zigbee2mqtt()", "skipped features", iobDev._id, zigbeeDev.friendly_name, JSON.stringify(typedFeatures, null, 4)));
        } else {
          this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_zigbee2mqtt()", `skipped ${zigbeeDev.type}`, iobDev._id, zigbeeDev.friendly_name));
        }
        if (accCategory && srvType) {
          this.log.debug((0, import_sprintf_js.sprintf)("%-30s %-20s %-50s %s", "create_zigbee2mqtt()", `created ${zigbeeDev.type}`, iobDev._id, zigbeeDev.friendly_name));
          const grpName = idPath.slice(0, 2).join(".");
          const devName = `${grpName}.${zigbeeDev.friendly_name}`;
          characteristics.push({
            "name": "Name",
            "inOutFunction": "const",
            "inOutParameters": zigbeeDev.friendly_name
          });
          const accConfig = {
            "configType": "customdevice",
            "enabled": true,
            "groupString": grpName,
            // used by adapter only
            "name": devName,
            // NOTE: yahka adapter uses 'name' to build homekit UUID!
            "category": accCategory,
            "manufacturer": zigbeeDev.definition.vendor,
            // visible within iOS home app
            "serial": zigbeeDev.ieee_address,
            // visible within iOS home app
            "model": `${zigbeeDev.model_id} (${zigbeeDev.definition.model})`,
            // visible within iOS home app
            "firmware": zigbeeDev.software_build_id,
            // visible within iOS home app
            "services": []
          };
          accConfigs.push(accConfig);
          const accService = {
            "type": srvType,
            "subType": "",
            "name": zigbeeDev.friendly_name,
            "characteristics": characteristics
          };
          accConfig.services.push(accService);
        }
      }
    }
    return accConfigs;
  }
  /**
   * Is called when adapter shuts down - callback has to be called under any circumstances!
   */
  onUnload(callback) {
    try {
    } finally {
      callback();
    }
  }
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // createYahkaConfig(srcInstId, yahkaDstApt)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  async createYahkaConfig(srcInstId, yahkaDstApt) {
    const yahkaAptId = yahkaDstApt._id;
    this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "createYahkaConfig()", "target", yahkaAptId));
    const stateObjs = await this.getForeignObjectsAsync(`${srcInstId}.*`, "state") || {};
    const statesArr = Object.values(stateObjs);
    statesArr.sort((obj1, obj2) => obj1._id > obj2._id ? 1 : obj1._id < obj2._id ? -1 : 0);
    const yahkaNewDevs = await this.createYahkaDevs(statesArr);
    const yahkaOldDevs = yahkaDstApt["native"]["bridge"]["devices"];
    for (const yahkaNewDev of yahkaNewDevs) {
      const yahkaOldDev = yahkaOldDevs.find((oldDev) => oldDev.name === yahkaNewDev.name);
      yahkaNewDev.enabled = yahkaOldDev ? yahkaOldDev.enabled : true;
    }
    let yahkaChanged = false;
    for (const yahkaOldDev of yahkaOldDevs) {
      const keep = !yahkaNewDevs.some((newDev) => newDev.name === yahkaOldDev.name);
      if (keep) {
        this.log.warn((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", "keeping", yahkaOldDev.name, ""));
        yahkaOldDev.enabled = false;
        yahkaNewDevs.push();
      }
    }
    yahkaOldDevs.sort(sortBy("name"));
    yahkaNewDevs.sort(sortBy("name"));
    const diff = objDiff(yahkaOldDevs, yahkaNewDevs, "yahkaDevs");
    yahkaChanged = yahkaChanged || Object.values(diff).length > 0;
    if (Object.values(diff).length > 0) {
      this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", yahkaAptId, "diff", "\n" + JSON.stringify(diff, null, 4)));
    }
    if (yahkaChanged) {
      this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaConfig()", yahkaAptId, "saving yahka devices ...", ""));
      yahkaDstApt["native"]["bridge"]["devices"] = yahkaNewDevs;
      await this.setForeignObjectAsync(yahkaAptId, yahkaDstApt);
    }
  }
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // createYahkaDevs(iobSrcObjs)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~
  async createYahkaDevs(iobSrcObjs) {
    this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "createYahkaDevs()", "#" + iobSrcObjs.length, "..."));
    const yahkaNewDevs = [];
    if (!Array.isArray(iobSrcObjs)) {
      this.log.warn((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s %s", "createYahkaDevs()", "iobSrcObjs is not an arrray", "", ""));
    } else {
      for (const iobSrcObj of iobSrcObjs) {
        const yahkaNewDev = await this.createYahkaDev(iobSrcObjs, iobSrcObj);
        if (yahkaNewDev) {
          yahkaNewDevs.push(yahkaNewDev);
        }
      }
    }
    this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "createYahkaDevs()", "#" + iobSrcObjs.length, "done."));
    return yahkaNewDevs;
  }
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  // createYahkaDev(iobSrcObjs, iobSrcObj)
  // ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
  async createYahkaDev(iobSrcObjs, iobSrcObj) {
    const objRole = iobSrcObj.common.role;
    const objName = iobSrcObj.common.name;
    const objValType = iobSrcObj.common.type;
    const objId = iobSrcObj._id;
    const idPath = objId.split(".");
    const idBase = idPath.slice(0, -1).join(".");
    const idLeaf = idPath.slice(-1)[0];
    const devCfg = {
      "configType": "customdevice",
      // buggy: will not show up in iOS
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
      "enabled": true,
      "groupString": idPath.slice(0, 2).join(".")
      // used by adapter only
    };
    if (idPath[0] === "danfoss-icon") {
      if (idLeaf === "HousePause") {
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
        const nameStr = (await this.getForeignStateAsync(nameId) || {}).val || "n/a";
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
                "inOutFunction": "ioBroker.State.OnlyACK",
                "inOutParameters": idBase + ".ValveState",
                "conversionFunction": "script",
                "conversionParameters": { "toHomeKit": "return (value) ? 1 : 2;", "toIOBroker": "return (value == 1);" }
              }
              // TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
            ]
            // CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
          }
        ];
      }
    } else if (idPath[0] === "openweathermap" && idPath[3] === "current") {
      const nameStr = objName.split(".").join(" ");
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
      const nameStr = (await this.getForeignStateAsync(nameId) || {}).val || "n/a";
      devCfg.firmware = "" + (await this.getForeignStateAsync(idPath.slice(0, -2).join(".") + ".version") || { val: "n/a" }).val;
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
        devCfg.firmware = "" + (await this.getForeignStateAsync(idPath.slice(0, -2).join(".") + ".version") || { val: "n/a" }).val;
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": nameId },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      }
    } else if (idPath[0] === "sonoff" && ["POWER1", "POWER2", "SI7021_Temperature", "SI7021_Humidity"].indexOf(idLeaf) >= 0) {
      const nameStr = (await this.getForeignStateAsync(`${idBase}.DeviceName`) || {}).val || "n/a";
      devCfg.firmware = "" + (await this.getForeignStateAsync(`${idBase}.INFO.Info1_Version`) || {}).val || "n/a";
      if (["POWER1", "POWER2"].indexOf(idLeaf) >= 0) {
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": "" + nameStr,
            "characteristics": [
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.DeviceName` },
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
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.DeviceName` },
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
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.DeviceName` },
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
          // objName:		e.g. 'Albi da'
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
          // LightSensor
          "type": "LightSensor",
          "subType": "",
          "name": objName,
          // objName:		e.g. ''
          "characteristics": [
            { "name": "Name", "inOutFunction": "const", "inOutParameters": objName },
            { "name": "CurrentAmbientLightLevel", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
          ]
        }
      ];
    } else if (idPath[0] === "fritzdect" && ["tsoll", "tist", "celsius"].includes(idLeaf)) {
      const nameStr = (await this.getForeignStateAsync(`${idBase}.name`) || {}).val || "n/a";
      devCfg.model = "" + (await this.getForeignStateAsync(`${idBase}.productname`) || {}).val || "n/a";
      devCfg.firmware = "" + (await this.getForeignStateAsync(`${idBase}.fwversion`) || {}).val || "n/a";
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
                { "name": "TargetTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.tsoll` },
                { "name": "CurrentTemperature", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.celsius` },
                { "name": "TargetHeatingCoolingState", "inOutFunction": "const", "inOutParameters": "3" },
                { "name": "CurrentHeatingCoolingState", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.heatingCoolingState` }
              ]
              // TargetHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL, 3 := AUTO
            },
            // CurrentHeatingCoolingState:		0 := OFF, 1 := HEAT, 2 := COOL
            {
              "type": "BatteryService",
              "subType": "",
              "name": "" + nameStr,
              "characteristics": [
                { "name": "ChargingState", "inOutFunction": "const", "inOutParameters": "2" },
                { "name": "BatteryLevel", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.battery` },
                //{ 'name': 'StatusLowBattery',			'inOutFunction': 'ioBroker.State.OnlyACK',	'inOutParameters': `${idBase}.batterylow`	},
                {
                  "name": "StatusLowBattery",
                  "inOutFunction": "ioBroker.State.OnlyACK",
                  "inOutParameters": `${idBase}.battery`,
                  "conversionFunction": "script",
                  "conversionParameters": { "toHomeKit": "return (value <= 20);", "toIOBroker": "return false;" }
                }
                // fritzdect battery (level) [%]
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
              { "name": "Name", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": `${idBase}.name` },
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
        devCfg.category = AccCatId.Switch;
        devCfg.services = [
          {
            "type": "Switch",
            "subType": "",
            "name": devCfg.model,
            "characteristics": [
              { "name": "Name", "inOutFunction": "const", "inOutParameters": devCfg.model },
              { "name": "On", "inOutFunction": "ioBroker.State.OnlyACK", "inOutParameters": objId }
            ]
          }
        ];
      }
    } else if (idPath[0] === "0_userdata" && idPath[2] === "pin") {
      if (objRole === "door.lock") {
        devCfg.category = AccCatId.Door_lock;
        devCfg.services = [
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
      } else if (objRole === "garage.opener") {
        devCfg.category = AccCatId.Door_lock;
        devCfg.services = [
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
      } else if (objRole === "switch.light") {
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
      } else if (objRole === "switch.fan") {
        devCfg.category = AccCatId.Fan;
        devCfg.services = [
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
      } else if (objRole === "sensor.leak") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
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
      } else if (objRole === "sensor.motion") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
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
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
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
      } else if (objRole === "indicator") {
        devCfg.category = AccCatId.Sensor;
        devCfg.services = [
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
      } else {
        this.log.debug((0, import_sprintf_js.sprintf)('%-30s %-20s %s (role "%s" not implemtented)', "createYahkaDev()", "ignored", objId, objRole));
      }
    } else if (idPath[0] === "tr-064" && idPath[2] == "devices" && idLeaf == "active" && objRole === "state") {
      const nameStr = idPath[idPath.length - 2];
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
      this.log.info((0, import_sprintf_js.sprintf)("%-31s %-20s %-50s", "createYahkaDev()", "created", devCfg.name));
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
//# sourceMappingURL=main.old.js.map
