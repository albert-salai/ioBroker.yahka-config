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
var util_exports = {};
__export(util_exports, {
  IIR: () => IIR,
  Magnus: () => Magnus,
  RLS: () => RLS,
  newtonRaphson: () => newtonRaphson,
  parabola: () => parabola,
  sortBy: () => sortBy
});
module.exports = __toCommonJS(util_exports);
var import_io_adapter = require("./io-adapter");
var import_numjs = __toESM(require("numjs"));
class AdapterGet {
  get logf() {
    return import_io_adapter.IoAdapter.get().logf;
  }
}
;
const adapter = new AdapterGet();
function sortBy(key) {
  return (a, b) => a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0;
}
function parabola(x, y) {
  const xx0 = x[0] * x[0];
  const xx1 = x[1] * x[1];
  const xx2 = x[2] * x[2];
  const y10 = y[1] - y[0];
  const y20 = y[2] - y[0];
  const y21 = y[2] - y[1];
  const x10 = x[1] - x[0];
  const x20 = x[2] - x[0];
  const x21 = x[2] - x[1];
  const den = x10 * x20 * x21;
  return {
    "a": (-x[0] * y21 + x[1] * y20 - x[2] * y10) / den,
    "b": (xx0 * y21 - xx1 * y20 + xx2 * y10) / den,
    "c": (-xx0 * (x[1] * y[2] - x[2] * y[1]) - x[0] * (xx2 * y[1] - xx1 * y[2]) + x[1] * x[2] * x21 * y[0]) / den
  };
}
class Magnus {
  a = 17.62;
  // see https://library.wmo.int/viewer/68695/download?file=8_I-2023_en.pdf&type=pdf&navigator=1
  b = 243.12;
  // Guide to Instruments and Methods of Observation - Volume I - Measurement of Meteorological VariablesGuide to Meteorological Instruments and Methods of Observation
  c = 6.112;
  // ANNEX 4.B. FORMULAE FOR THE COMPUTATION OF MEASURES OF HUMIDITY, page 198, equation 4.B.1
  // sdd(T)
  sdd(T) {
    const { a, b, c } = this;
    return c * Math.exp(a * T / (b + T));
  }
  // dd(T, rh)
  dd(T, rh) {
    return rh / 100 * this.sdd(T);
  }
  // td(T, rh)
  td(T, rh) {
    const { a, b, c } = this;
    const sdd = this.dd(T, rh);
    const v = Math.log(sdd / c);
    return b * v / (a - v);
  }
}
;
class IIR {
  b;
  a;
  w;
  /**
   *
   * @param opts
   */
  constructor(opts) {
    if (Array.isArray(opts.b) && Array.isArray(opts.a) && opts.b.length === opts.a.length && opts.a.length > 0 && opts.a[0] !== void 0) {
      const a0 = opts.a[0];
      this.b = opts.b.map((b) => b / a0);
      this.a = opts.a.map((a) => a / a0);
      this.w = Array(this.a.length).fill(null);
    } else {
      throw new Error(`${this.constructor.name}: constructor(): invalid config ${JSON.stringify(opts)}`);
    }
  }
  /**
   *
   * @param x_0
   * @returns
   */
  next(x_0) {
    if (this.w[0] === null) {
      const a_sum = this.a.reduce((sum, a_i) => sum + a_i, 0);
      this.w.fill(x_0 / a_sum);
    }
    this.w.unshift(0);
    this.w[0] = this.a.reduce((acc, a_i, i) => {
      var _a;
      return acc - a_i * ((_a = this.w[i]) != null ? _a : 0);
    }, x_0);
    this.w.pop();
    const y_0 = this.b.reduce((acc, b_i, i) => {
      var _a;
      return acc + b_i * ((_a = this.w[i]) != null ? _a : 0);
    }, 0);
    return y_0;
  }
}
function newtonRaphson(f, x0, options) {
  var _a, _b, _c, _d, _e, _f, _g;
  const tolerance = (_a = options.tolerance) != null ? _a : 1e-9;
  const epsilon = (_b = options.epsilon) != null ? _b : 1e-16;
  const maxIter = (_c = options.maxIter) != null ? _c : 20;
  const h = (_d = options.h) != null ? _d : 1e-4;
  const verbose = (_e = options.verbose) != null ? _e : false;
  const xMin = ((_f = options.xMin) != null ? _f : Number.MIN_VALUE) + (options.fp ? 0 : 2 * h + tolerance);
  const xMax = ((_g = options.xMax) != null ? _g : Number.MAX_VALUE) - (options.fp ? 0 : 2 * h + tolerance);
  const hr = 1 / h;
  let iter = 0;
  while (iter++ < maxIter) {
    const y = f(x0);
    let yp;
    if (options.fp) {
      yp = options.fp(x0);
    } else {
      const yph = f(x0 + h);
      const ymh = f(x0 - h);
      const yp2h = f(x0 + 2 * h);
      const ym2h = f(x0 - 2 * h);
      yp = (ym2h - yp2h + 8 * (yph - ymh)) * hr / 12;
    }
    if (Math.abs(yp) <= epsilon * Math.abs(y)) {
      adapter.logf.error("Newton-Raphson: failed to converged due to nearly zero first derivative");
      return false;
    }
    const x1 = Math.max(xMin, Math.min(xMax, x0 - y / yp));
    if (Math.abs(x1 - x0) <= tolerance * Math.abs(x1)) {
      if (verbose) {
        adapter.logf.debug("Newton-Raphson: converged to x = " + String(x1) + " after " + String(iter) + " iterations");
      }
      return x1;
    }
    x0 = x1;
  }
  adapter.logf.warn("Newton-Raphson: Maximum iterations reached (" + String(maxIter) + ")");
  return false;
}
class RLS {
  dimensions = 1;
  // Number of features
  lambda = 0.95;
  // Forgetting			factor
  eye = import_numjs.default.identity(this.dimensions);
  // Identity				matrix
  w_hat = import_numjs.default.zeros(this.dimensions);
  // Estimated Parameters	vector
  P = this.eye.multiply(1);
  // Covariance			matrix
  /**
   *
   * @param w
   * @param delta
   * @param lambda
   */
  init(w, lambda, P) {
    this.dimensions = w.length;
    this.lambda = lambda;
    this.eye = import_numjs.default.identity(this.dimensions);
    this.w_hat = import_numjs.default.array(w).reshape(this.dimensions, 1);
    adapter.logf.debug("%-15s %-15s %-10s %s", this.constructor.name, "init()", "eye", JSON.stringify(this.eye));
    adapter.logf.debug("%-15s %-15s %-10s %s", this.constructor.name, "init()", "w_hat", JSON.stringify(this.w_hat));
    if (typeof P === "number") {
      this.P = this.eye.multiply(P);
    } else if (P[0]) {
      this.P = import_numjs.default.array(P.flat()).reshape(P.length, P[0].length);
    }
    adapter.logf.debug("%-15s %-15s %-10s %s", this.constructor.name, "init()", "P", JSON.stringify(this.P));
  }
  // Update the model with new data
  update(x_vals, y_val) {
    const x = import_numjs.default.array(x_vals).reshape(this.dimensions, 1);
    const xT = x.T;
    const y_hat = xT.dot(this.w_hat).get(0, 0);
    const y_err = y_val - y_hat;
    const xT_P = xT.dot(this.P);
    const x_xT_P = x.dot(xT_P);
    const xT_P_x = xT_P.dot(x).get(0, 0);
    const P_x = this.P.dot(x);
    const gain = P_x.multiply(1 / (this.lambda + xT_P_x));
    this.P = this.P.dot(this.eye.subtract(x_xT_P)).multiply(1 / (this.lambda + xT_P_x));
    this.w_hat.add(gain.multiply(y_err), false);
    return this.w_hat.reshape(this.dimensions).tolist();
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  IIR,
  Magnus,
  RLS,
  newtonRaphson,
  parabola,
  sortBy
});
//# sourceMappingURL=util.js.map
