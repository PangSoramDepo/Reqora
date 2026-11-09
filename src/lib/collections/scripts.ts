import "server-only";

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import { VARIABLE_NAME } from "@/lib/workflows/schema";
import { hostCrypto } from "./script-crypto";
import { DEBUG_MAX_CHARS, DEBUG_MAX_STEPS, DEBUG_PRELUDE, instrumentScript, type DebugStep, type ScriptDebug, type ScriptDebugLog } from "./script-debug";
import type { DraftRequest } from "./request";

/**
 * User scripts run inside QuickJS compiled to WebAssembly: a separate JS engine with no network, file system,
 * timers or Node APIs. Each script gets a fresh runtime with a CPU deadline and a memory cap, and only
 * JSON goes in and out. Nothing a script does can reach the server process except its returned data.
 */

const TIME_LIMIT_MS = 1000;
const MEMORY_LIMIT_BYTES = 32 * 1024 * 1024;
const MAX_LOGS = 200;
const MAX_LOG_CHARS = 2000;
const MAX_ENV_VALUE = 10_000;

const RANDOM_POOL_BYTES = 1024;

let modulePromise: Promise<QuickJSWASMModule> | undefined;
const quickjs = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(variant));

/**
 * Libraries scripts can `require`, like Postman's built-ins. Each is a self-contained UMD bundle evaluated
 * inside the sandbox (only when the script mentions it), so it gets no more access than the script itself.
 */
/**
 * Libraries scripts can `require` (as in Postman). Each is evaluated inside the sandbox only when a script uses
 * it: `require("name")`, or its global matching `detect` (e.g. `_.get(...)`, `CryptoJS.AES`, `moment()`).
 */
export const SCRIPT_MODULES = {
  "crypto-js": { file: "crypto-js/crypto-js.js", global: "CryptoJS", detect: /\bCryptoJS\b/ },
  lodash: { file: "lodash/lodash.min.js", global: "_", detect: /(^|[^\w$.])_\s*[.(]/m },
  moment: { file: "moment/min/moment.min.js", global: "moment", detect: /\bmoment\s*[.(]/ },
} as const;
export type ScriptModuleName = keyof typeof SCRIPT_MODULES;

const moduleSources = new Map<ScriptModuleName, string>();
function moduleSource(name: ScriptModuleName): string {
  let source = moduleSources.get(name);
  if (source === undefined) {
    // Resolved from the app root at runtime (not bundled): the file is evaluated in QuickJS, never in Node.
    const resolve = createRequire(path.join(process.cwd(), "package.json")).resolve;
    source = readFileSync(resolve(SCRIPT_MODULES[name].file), "utf8");
    moduleSources.set(name, source);
  }
  return source;
}

/** Known modules a script mentions via require("…") or the matching global (e.g. CryptoJS). */
function modulesUsed(code: string): ScriptModuleName[] {
  return (Object.keys(SCRIPT_MODULES) as ScriptModuleName[]).filter((name) => {
    const quoted = name.replace(/[-]/g, "\\-");
    return new RegExp(`require\\(\\s*["'\`]${quoted}["'\`]\\s*\\)`).test(code) || SCRIPT_MODULES[name].detect.test(code);
  });
}

export type ScriptPhase = "pre" | "post";
export type ScriptScope = "collection" | "folder" | "request";
/**
 * `code`: the user's code. `wrap`: a caller's wrapper around it (e.g. a Script node's), adding `lineOffset` lines
 * before it, so errors report the user's line numbers. `locals`: names the wrapper defines for the code, which
 * debug runs record too. `shown`: the code a debug run shows when `code` isn't exactly what was written.
 */
export type ScriptSource = {
  scope: ScriptScope;
  name: string;
  code: string;
  lineOffset?: number;
  wrap?: (code: string) => string;
  locals?: string[];
  shown?: string;
};

/** rq.request: templates unresolved, params separate, no auth header yet (see DraftRequest). */
export type ScriptRequest = DraftRequest;
export type ScriptResponse = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  responseTime: number;
};

export type ScriptLog = { level: "log" | "info" | "warn" | "error"; message: string; scope: ScriptScope; source: string };
export type ScriptTest = { name: string; passed: boolean; error?: string; scope: ScriptScope; source: string };
export type ScriptError = { phase: ScriptPhase; scope: ScriptScope; source: string; message: string };

export type ScriptState = {
  request: ScriptRequest;
  variables: Record<string, string>;
  logs: ScriptLog[];
  tests: ScriptTest[];
  /**
   * Environment changes made by rq.environment.set / unset so far (null = unset). Later scripts see them,
   * `{{env.NAME}}` resolves them, and the caller persists them to the selected environment afterwards.
   */
  environment: Record<string, string | null>;
  /** Test-user changes made by rq.user.set / unset so far (null = unset); the caller saves them to the user. */
  user?: Record<string, string | null>;
};

/** The test user scripts act as: rq.user.name / roles / role, and get / set of their values. */
export type ScriptUser = { name: string; roles: string[]; role: string };

// Runs inside QuickJS. Builds the `rq` API from __input (a JSON string) and exposes __output() for the result.
const PRELUDE = String.raw`
const __in = JSON.parse(__input);
const __logs = [];
const __tests = [];
// Stack frames in the user's script ("<scope>-<phase>.js"), as "line N:C"; __in.lineOffset = wrapper lines before it.
const __frames = (stack) => String(stack || "").split("\n")
  .filter((l) => !l.includes("<eval>"))
  .map((l) => /\((?:collection|folder|request)-(?:pre|post)\.js:(\d+)(?::(\d+))?\)/.exec(l))
  .filter(Boolean)
  .map((m) => ({ line: Number(m[1]) - __in.lineOffset, col: m[2] }))
  .filter((f) => f.line >= 1)
  .map((f) => "    at line " + f.line + (f.col ? ":" + f.col : ""));
const __isError = (v) => v instanceof Error || (v !== null && typeof v === "object" && typeof v.message === "string" && typeof v.stack === "string");
const __fmtError = (e) => {
  const extra = Object.keys(e).filter((k) => k !== "message" && k !== "stack");
  let text = (e.name || "Error") + ": " + e.message;
  if (extra.length) { try { text += " " + JSON.stringify(Object.fromEntries(extra.map((k) => [k, e[k]]))); } catch (x) {} }
  const frames = __frames(e.stack);
  return frames.length ? text + "\n" + frames.join("\n") : text;
};
const __fmt = (v) => {
  if (typeof v === "string") return v;
  if (v === undefined || typeof v === "function" || typeof v === "symbol") return String(v);
  if (__isError(v)) return __fmtError(v);
  // Errors nested in objects show their name and message instead of {}.
  try { return JSON.stringify(v, (k, x) => (__isError(x) ? { name: x.name, message: x.message, ...x } : x)); } catch (e) { return String(v); }
};
const __log = (level) => (...args) => {
  if (__logs.length < ${MAX_LOGS}) __logs.push({ level, message: args.map(__fmt).join(" ").slice(0, ${MAX_LOG_CHARS}), ...(__in.debug ? { step: __dbgStep() } : {}) });
};
globalThis.console = { log: __log("log"), info: __log("info"), warn: __log("warn"), error: __log("error") };

// Secure randomness from the host (a fixed pool per script), for crypto-js encryption and similar.
const __pool = __in.random;
let __poolAt = 0;
globalThis.crypto = {
  getRandomValues(array) {
    const size = array.BYTES_PER_ELEMENT || 1;
    for (let i = 0; i < array.length; i++) {
      let v = 0;
      for (let b = 0; b < size; b++) {
        if (__poolAt >= __pool.length) throw new Error("crypto.getRandomValues: out of random bytes (${RANDOM_POOL_BYTES} per script)");
        v = v * 256 + __pool[__poolAt++];
      }
      array[i] = v;
    }
    return array;
  },
};

const __modules = {};
const __moduleNames = ${JSON.stringify(Object.keys(SCRIPT_MODULES))};
globalThis.require = (name) => {
  if (Object.prototype.hasOwnProperty.call(__modules, name)) return __modules[name];
  throw new Error("Cannot find module " + JSON.stringify(String(name)) + ". Scripts can require: " + __moduleNames.join(", "));
};

const __deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
class AssertionError extends Error {}
const __expect = (actual) => {
  const fail = (msg) => { throw new AssertionError(msg); };
  const show = (v) => __fmt(v);
  const api = {
    toBe: (e) => (actual === e ? api : fail("expected " + show(actual) + " to be " + show(e))),
    toEqual: (e) => (__deepEqual(actual, e) ? api : fail("expected " + show(actual) + " to equal " + show(e))),
    toContain: (e) => ((typeof actual === "string" || Array.isArray(actual)) && actual.includes(e) ? api : fail("expected " + show(actual) + " to contain " + show(e))),
    toBeTruthy: () => (actual ? api : fail("expected " + show(actual) + " to be truthy")),
    toBeFalsy: () => (!actual ? api : fail("expected " + show(actual) + " to be falsy")),
    toBeGreaterThan: (e) => (actual > e ? api : fail("expected " + show(actual) + " to be greater than " + show(e))),
    toBeLessThan: (e) => (actual < e ? api : fail("expected " + show(actual) + " to be less than " + show(e))),
    toHaveProperty: (k) => (actual != null && Object.prototype.hasOwnProperty.call(actual, k) ? api : fail("expected object to have property " + show(k))),
    toMatch: (re) => (new RegExp(re).test(String(actual)) ? api : fail("expected " + show(actual) + " to match " + String(re))),
  };
  return api;
};

const __request = __in.request;
const __variables = __in.variables;
const __env = __in.environment;
// Replaces {{NAME}} (Postman style) and Reqora's {{env.NAME}} / {{vars.NAME}}; unknown names are left as they are.
const __replaceIn = (text, lookup) => String(text).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => {
  const v = k.startsWith("env.") ? (Object.prototype.hasOwnProperty.call(__env, k.slice(4)) ? __env[k.slice(4)] : undefined)
    : k.startsWith("user.") ? (Object.prototype.hasOwnProperty.call(__userVals, k.slice(5)) ? __userVals[k.slice(5)] : undefined)
    : k.startsWith("vars.") ? __variables[k.slice(5)]
    : lookup(k);
  return v === undefined ? m : v;
});
const __envChanges = {};
const __userInfo = __in.user || null;
const __userVals = __in.userValues || {};
const __userChanges = {};
const __noUser = () => { throw new Error("rq.user: no test user is acting here — pick one under Run as / Send as, or add test users on the Secrets page (Test Users)"); };
globalThis.rq = {
  request: __request,
  response: __in.response && {
    ...__in.response,
    json() { return JSON.parse(__in.response.body); },
    text() { return __in.response.body; },
  },
  variables: {
    get: (k) => __variables[k],
    set: (k, v) => { __variables[String(k)] = String(v); },
    unset: (k) => { delete __variables[k]; },
    toObject: () => ({ ...__variables }),
  },
  environment: {
    get: (k) => (Object.prototype.hasOwnProperty.call(__env, k) ? __env[k] : undefined),
    set: (k, v) => {
      if (v === undefined || v === null) throw new TypeError("rq.environment.set(" + __fmt(k) + ") needs a value; use unset to remove it");
      const value = typeof v === "string" ? v : __fmt(v);
      __env[String(k)] = value;
      __envChanges[String(k)] = value;
    },
    unset: (k) => { delete __env[String(k)]; __envChanges[String(k)] = null; },
    has: (k) => Object.prototype.hasOwnProperty.call(__env, k),
    replaceIn: (text) => __replaceIn(text, (k) => rq.environment.get(k)),
  },
  // The acting test user: values saved here go to that user (e.g. the access token from a login response).
  user: __userInfo ? {
    name: __userInfo.name,
    roles: __userInfo.roles,
    role: __userInfo.role,
    get: (k) => (Object.prototype.hasOwnProperty.call(__userVals, k) ? __userVals[k] : undefined),
    set: (k, v) => {
      if (v === undefined || v === null) throw new TypeError("rq.user.set(" + __fmt(k) + ") needs a value; use unset to remove it");
      const value = typeof v === "string" ? v : __fmt(v);
      __userVals[String(k)] = value;
      __userChanges[String(k)] = value;
    },
    unset: (k) => { delete __userVals[String(k)]; __userChanges[String(k)] = null; },
    has: (k) => Object.prototype.hasOwnProperty.call(__userVals, k),
  } : { name: undefined, roles: [], role: undefined, get: __noUser, set: __noUser, unset: __noUser, has: () => false },
  test: (name, fn) => {
    try { fn(); __tests.push({ name: String(name), passed: true }); }
    catch (e) { __tests.push({ name: String(name), passed: false, error: String(e && e.message || e) }); }
  },
  expect: __expect,
};

// ---- Postman compatibility: pm.* (and legacy tests[] / postman.*) on top of rq ----
const __hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const __b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
globalThis.btoa = (input) => {
  const s = String(input);
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
    if (a > 255 || b > 255 || c > 255) throw new Error("btoa: characters outside Latin1");
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += __b64[(n >> 18) & 63] + __b64[(n >> 12) & 63] + (isNaN(b) ? "=" : __b64[(n >> 6) & 63]) + (isNaN(c) ? "=" : __b64[n & 63]);
  }
  return out;
};
globalThis.atob = (input) => {
  const s = String(input).replace(/[\s=]+/g, "");
  let out = "", bits = 0, value = 0;
  for (const ch of s) {
    const idx = __b64.indexOf(ch);
    if (idx < 0) throw new Error("atob: invalid base64");
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) { bits -= 8; out += String.fromCharCode((value >> bits) & 255); }
  }
  return out;
};

// ---- Web APIs: TextEncoder / TextDecoder (UTF-8) and crypto.subtle (run by the host, see script-crypto.ts) ----
const __view = (src, what) => {
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  throw new TypeError((what || "data") + " must be an ArrayBuffer or typed array");
};
globalThis.TextEncoder = class TextEncoder {
  get encoding() { return "utf-8"; }
  encode(input) {
    const s = input === undefined ? "" : String(input);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
};
globalThis.TextDecoder = class TextDecoder {
  constructor(label) {
    const l = String(label === undefined ? "utf-8" : label).toLowerCase();
    if (l !== "utf-8" && l !== "utf8") throw new RangeError("TextDecoder: only utf-8 is supported in scripts");
  }
  get encoding() { return "utf-8"; }
  decode(input) {
    if (input === undefined) return "";
    const b = __view(input, "TextDecoder.decode input");
    let out = "";
    for (let i = 0; i < b.length; ) {
      const x = b[i];
      let c = 0xfffd, n = 1;
      if (x < 0x80) c = x;
      else if (x >= 0xc2 && x < 0xe0 && (b[i + 1] & 0xc0) === 0x80) { c = ((x & 31) << 6) | (b[i + 1] & 63); n = 2; }
      else if (x >= 0xe0 && x < 0xf0 && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) { c = ((x & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63); n = 3; }
      else if (x >= 0xf0 && x < 0xf5 && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) {
        c = ((x & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63); n = 4;
      }
      out += String.fromCodePoint(c);
      i += n;
    }
    return out;
  }
};

const __hostCall = globalThis.__hostCrypto;
delete globalThis.__hostCrypto;
const __toB64 = (src, what) => {
  const b = __view(src, what);
  let s = "";
  for (let i = 0; i < b.length; i += 4096) s += String.fromCharCode.apply(null, b.subarray(i, i + 4096));
  return btoa(s);
};
const __fromB64 = (b64) => {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
};
const __host = (op, args) => JSON.parse(__hostCall(op, JSON.stringify(args)));
class CryptoKey {
  constructor(d) {
    this.type = d.type;
    this.extractable = d.extractable;
    this.algorithm = d.algorithm;
    this.usages = d.usages;
    Object.defineProperty(this, "__d", { value: d });
  }
}
globalThis.CryptoKey = CryptoKey;
const __key = (key) => {
  if (!(key instanceof CryptoKey)) throw new TypeError("key must be a CryptoKey from crypto.subtle.importKey");
  return key.__d;
};
// Binary members of an algorithm (iv, additionalData, label) travel as base64.
const __alg = (alg) => {
  if (!alg || typeof alg !== "object") return alg;
  const out = { ...alg };
  for (const k of ["iv", "additionalData", "label"]) if (out[k] !== undefined) out[k] = __toB64(out[k], "algorithm." + k);
  return out;
};
const __async = (fn) => (...args) => { try { return Promise.resolve(fn(...args)); } catch (e) { return Promise.reject(e); } };
const __unsupported = (name) => __async(() => { throw new Error("crypto.subtle." + name + " is not supported in scripts"); });
globalThis.crypto.subtle = {
  digest: __async((algorithm, data) => __fromB64(__host("digest", { algorithm, data: __toB64(data) }))),
  importKey: __async((format, keyData, algorithm, extractable, usages) => new CryptoKey(__host("importKey", {
    format, keyData: format === "jwk" ? keyData : __toB64(keyData, "keyData"), algorithm, extractable, usages,
  }))),
  exportKey: __async((format, key) => { const r = __host("exportKey", { format, key: __key(key) }); return format === "jwk" ? r : __fromB64(r); }),
  sign: __async((algorithm, key, data) => __fromB64(__host("sign", { algorithm: __alg(algorithm), key: __key(key), data: __toB64(data) }))),
  verify: __async((algorithm, key, signature, data) => __host("verify", { algorithm: __alg(algorithm), key: __key(key), signature: __toB64(signature, "signature"), data: __toB64(data) })),
  encrypt: __async((algorithm, key, data) => __fromB64(__host("encrypt", { algorithm: __alg(algorithm), key: __key(key), data: __toB64(data) }))),
  decrypt: __async((algorithm, key, data) => __fromB64(__host("decrypt", { algorithm: __alg(algorithm), key: __key(key), data: __toB64(data) }))),
  generateKey: __unsupported("generateKey"),
  deriveKey: __unsupported("deriveKey"),
  deriveBits: __unsupported("deriveBits"),
  wrapKey: __unsupported("wrapKey"),
  unwrapKey: __unsupported("unwrapKey"),
};
globalThis.crypto.randomUUID = () => {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
};

/** A Postman-style header list over a plain { name: value } record. */
const __headerList = (record, readOnly) => {
  const find = (name) => Object.keys(record).find((k) => k.toLowerCase() === String(name).toLowerCase());
  const write = (fn) => (...args) => { if (readOnly) throw new Error("headers are read-only here"); return fn(...args); };
  const put = (h, v) => {
    const key = typeof h === "string" ? h : h.key;
    const value = typeof h === "string" ? v : h.value;
    const existing = find(key);
    if (existing !== undefined && existing !== key) delete record[existing];
    record[key] = String(value);
  };
  return {
    get: (name) => { const k = find(name); return k === undefined ? undefined : record[k]; },
    has: (name, value) => { const k = find(name); return k !== undefined && (value === undefined || record[k] === String(value)); },
    toObject: () => ({ ...record }),
    all: () => Object.keys(record).map((key) => ({ key, value: record[key] })),
    each: (fn) => Object.keys(record).forEach((key) => fn({ key, value: record[key] })),
    count: () => Object.keys(record).length,
    add: write(put),
    upsert: write(put),
    remove: write((name) => { const k = find(name); if (k !== undefined) delete record[k]; }),
  };
};

class __PmAssertionError extends Error {}
/** Chai-style expect: pm.expect(v).to.be.ok, .to.equal(x), .to.eql(x), .to.include(x), .to.have.property(k) … */
const __chai = (initial) => {
  let actual = initial;
  let negate = false;
  let deep = false;
  const s = (v) => (typeof v === "string" ? JSON.stringify(v) : __fmt(v));
  const check = (pass, msg) => {
    if (Boolean(pass) === negate) throw new __PmAssertionError("expected " + s(actual) + (negate ? " not " : " ") + msg);
    negate = false;
    return self;
  };
  const self = {};
  for (const word of ["to", "be", "been", "is", "that", "which", "and", "has", "have", "with", "at", "of", "same", "but", "does", "still", "also"]) {
    Object.defineProperty(self, word, { get: () => self });
  }
  Object.defineProperty(self, "not", { get: () => { negate = !negate; return self; } });
  Object.defineProperty(self, "deep", { get: () => { deep = true; return self; } });
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
  const getters = {
    ok: () => check(actual, "to be truthy"),
    true: () => check(actual === true, "to be true"),
    false: () => check(actual === false, "to be false"),
    null: () => check(actual === null, "to be null"),
    undefined: () => check(actual === undefined, "to be undefined"),
    NaN: () => check(Number.isNaN(actual), "to be NaN"),
    exist: () => check(actual !== null && actual !== undefined, "to exist"),
    empty: () => check(
      actual == null || (typeof actual === "string" || Array.isArray(actual) ? actual.length === 0 : typeof actual === "object" ? Object.keys(actual).length === 0 : false),
      "to be empty",
    ),
  };
  for (const [name, fn] of Object.entries(getters)) Object.defineProperty(self, name, { get: fn });
  const equal = (e) => check(deep ? __deepEqual(actual, e) : actual === e, "to equal " + s(e));
  self.equal = self.equals = self.eq = equal;
  self.eql = self.eqls = (e) => check(__deepEqual(actual, e), "to deeply equal " + s(e));
  self.above = self.gt = self.greaterThan = (n) => check(actual > n, "to be above " + s(n));
  self.below = self.lt = self.lessThan = (n) => check(actual < n, "to be below " + s(n));
  self.least = self.gte = (n) => check(actual >= n, "to be at least " + s(n));
  self.most = self.lte = (n) => check(actual <= n, "to be at most " + s(n));
  self.within = (a, b) => check(actual >= a && actual <= b, "to be within " + a + ".." + b);
  self.include = self.includes = self.contain = self.contains = (e) => {
    let pass = false;
    if (typeof actual === "string") pass = actual.includes(String(e));
    else if (Array.isArray(actual)) pass = actual.some((v) => (deep || typeof e === "object" ? __deepEqual(v, e) : v === e));
    else if (actual && typeof actual === "object" && e && typeof e === "object") pass = Object.keys(e).every((k) => __deepEqual(actual[k], e[k]));
    return check(pass, "to include " + s(e));
  };
  self.oneOf = (list) => check(Array.isArray(list) && list.some((v) => __deepEqual(v, actual)), "to be one of " + s(list));
  self.match = self.matches = (re) => check(new RegExp(re).test(String(actual)), "to match " + String(re));
  self.string = (sub) => check(typeof actual === "string" && actual.includes(sub), "to contain " + s(sub));
  self.a = self.an = (type) => check(typeOf(actual) === String(type).toLowerCase(), "to be a" + (/^[aeiou]/i.test(type) ? "n " : " ") + type);
  self.instanceOf = self.instanceof = (C) => check(actual instanceof C, "to be an instance of " + (C && C.name));
  self.lengthOf = self.length = (n) => check(actual != null && actual.length === n, "to have length " + n);
  self.keys = self.key = (...keys) => {
    const want = keys.length === 1 && Array.isArray(keys[0]) ? keys[0] : keys;
    return check(actual != null && want.every((k) => __hasOwn(actual, k)), "to have keys " + s(want));
  };
  self.property = (name, ...rest) => {
    const value = rest[0];
    const has = actual != null && (typeof actual === "object" || typeof actual === "function") && name in Object(actual);
    if (rest.length > 0) {
      check(has && __deepEqual(actual[name], value), "to have property " + s(name) + " of " + s(value));
    } else {
      check(has, "to have property " + s(name));
    }
    if (has) actual = actual[name];
    return self;
  };
  self.status = (code) => check(actual && actual.code === code, "to have status " + code);
  return self;
};

/** pm.variables: request-local values first, then the environment (like Postman's variable resolution). */
const __scopeVars = {
  get: (k) => { const v = rq.variables.get(k); return v !== undefined ? v : rq.environment.get(k); },
  set: (k, v) => rq.variables.set(k, typeof v === "string" ? v : __fmt(v)),
  unset: (k) => rq.variables.unset(k),
  has: (k) => rq.variables.get(k) !== undefined || rq.environment.has(k),
  toObject: () => rq.variables.toObject(),
  replaceIn: (text) => __replaceIn(text, (k) => __scopeVars.get(k)),
};
/** pm.environment / pm.collectionVariables / pm.globals: all persist to the selected Reqora environment. */
const __envVars = {
  get: (k) => rq.environment.get(k),
  set: (k, v) => rq.environment.set(k, v),
  unset: (k) => rq.environment.unset(k),
  has: (k) => rq.environment.has(k),
  clear: () => { throw new Error("clearing a whole environment isn't supported in Reqora scripts"); },
  toObject: () => { throw new Error("listing environment values isn't allowed; read names with .get(\"NAME\")"); },
  replaceIn: (text) => rq.environment.replaceIn(text),
  name: "",
};

const __queryList = () => ({
  all: () => __request.params.map((p) => ({ key: p.key, value: p.value })),
  get: (k) => { const p = __request.params.find((q) => q.key === k); return p && p.value; },
  has: (k) => __request.params.some((q) => q.key === k),
  add: (p) => { if (__in.response) throw new Error("the request is read-only after the response"); __request.params.push({ key: String(p.key), value: String(p.value) }); },
  upsert: (p) => {
    if (__in.response) throw new Error("the request is read-only after the response");
    const q = __request.params.find((x) => x.key === p.key);
    if (q) q.value = String(p.value); else __request.params.push({ key: String(p.key), value: String(p.value) });
  },
  remove: (k) => { if (__in.response) throw new Error("the request is read-only after the response"); __request.params = __request.params.filter((x) => x.key !== k); },
  toObject: () => Object.fromEntries(__request.params.map((p) => [p.key, p.value])),
});
// Splits a URL (possibly starting with a {{baseUrl}} template) into host, path and query.
const __parseUrl = (url) => {
  const m = /^(?:[a-z][a-z0-9+.-]*:)?(?:\/\/([^/?#]*)|(\{\{[^{}]*\}\}))?([^?#]*)(?:\?([^#]*))?/i.exec(String(url)) || [];
  return { host: m[1] || m[2] || "", path: m[3] || "/", query: m[4] || "" };
};
const __paramString = () => __request.params.map((p) => p.key + "=" + p.value).join("&");
const __urlObject = () => {
  const full = () => __request.url + (__request.params.length ? "?" + __paramString() : "");
  return {
    toString: full,
    getHost: () => __parseUrl(__request.url).host,
    getPath: () => __parseUrl(__request.url).path,
    getQueryString: () => __paramString(),
    getPathWithQuery: () => __parseUrl(__request.url).path + (__request.params.length ? "?" + __paramString() : ""),
    get query() { return __queryList(); },
  };
};
// rq.request.url is a plain string; give strings the Postman URL helpers too, so rq.request.url.getPath() works.
// For rq.request.url the query lives in rq.request.params.
const __ownQuery = (s) => { const q = __parseUrl(s).query; return q || (s === __request.url ? __paramString() : ""); };
for (const [name, fn] of Object.entries({
  getHost() { return __parseUrl(String(this)).host; },
  getPath() { return __parseUrl(String(this)).path; },
  getQueryString() { return __ownQuery(String(this)); },
  getPathWithQuery() { const s = String(this), q = __ownQuery(s); return __parseUrl(s).path + (q ? "?" + q : ""); },
})) Object.defineProperty(String.prototype, name, { value: fn, writable: true, configurable: true });
const __pmRequest = {
  get method() { return __request.method; },
  set method(v) { if (__in.response) throw new Error("the request is read-only after the response"); __request.method = String(v).toUpperCase(); },
  get url() { return __urlObject(); },
  set url(v) { if (__in.response) throw new Error("the request is read-only after the response"); __request.url = String(v); },
  headers: __headerList(__request.headers, Boolean(__in.response)),
  get body() {
    if (__request.body === undefined && Array.isArray(__request.form)) {
      const ro = () => { if (__in.response) throw new Error("the request is read-only after the response"); };
      const list = {
        all: () => __request.form.map((f) => ({ ...f })),
        get: (k) => { const f = __request.form.find((x) => x.key === k); return f && f.value; },
        has: (k) => __request.form.some((x) => x.key === k),
        count: () => __request.form.length,
        each: (fn) => __request.form.forEach((f) => fn({ ...f })),
        map: (fn) => __request.form.map((f) => fn({ ...f })),
        toObject: () => Object.fromEntries(__request.form.filter((f) => f.type !== "file").map((f) => [f.key, f.value])),
        add: (f) => { ro(); __request.form.push({ key: String(f.key), value: String(f.value ?? "") }); },
        upsert: (f) => {
          ro();
          const x = __request.form.find((y) => y.key === f.key && y.type !== "file");
          if (x) x.value = String(f.value ?? ""); else __request.form.push({ key: String(f.key), value: String(f.value ?? "") });
        },
        remove: (k) => { ro(); __request.form = __request.form.filter((x) => x.key !== k); },
      };
      const mode = __request.formMode === "formdata" ? "formdata" : "urlencoded";
      return { mode, [mode]: list, toString: () => __request.form.map((f) => f.key + "=" + f.value).join("&"), update: (v) => { __pmRequest.body = v; } };
    }
    if (__request.body === undefined && __request.file) {
      return { mode: "file", file: { src: __request.file.name, contentType: __request.file.contentType, size: __request.file.size }, toString: () => "", update: (v) => { __pmRequest.body = v; } };
    }
    if (__request.body === undefined) return undefined;
    return {
      mode: "raw",
      raw: __request.body,
      toString: () => __request.body,
      update: (v) => { __pmRequest.body = v; },
    };
  },
  set body(v) {
    if (__in.response) throw new Error("the request is read-only after the response");
    __request.body = typeof v === "string" ? v : v && v.raw !== undefined ? String(v.raw) : JSON.stringify(v);
  },
  addHeader: (h) => __headerList(__request.headers, Boolean(__in.response)).add(h),
  removeHeader: (name) => __headerList(__request.headers, Boolean(__in.response)).remove(name),
};

const __pmResponse = __in.response && (() => {
  const r = rq.response;
  const assertions = (negated) => {
    const fail = (pass, msg) => { if (Boolean(pass) === negated) throw new __PmAssertionError("expected response" + (negated ? " not " : " ") + msg); };
    const api = {
      have: {
        status: (v) => fail(typeof v === "number" ? r.status === v : String(r.statusText).toLowerCase() === String(v).toLowerCase(), "to have status " + v + " (got " + r.status + ")"),
        header: (name, value) => {
          const got = __headerList(r.headers, true).get(name);
          fail(got !== undefined && (value === undefined || got === String(value)), "to have header " + name + (value === undefined ? "" : ": " + value));
        },
        body: (v) => fail(v === undefined ? r.body.length > 0 : typeof v === "string" ? r.body === v : __deepEqual(JSON.parse(r.body), v), "to have body " + __fmt(v)),
        jsonBody: (path, value) => {
          let body;
          try { body = JSON.parse(r.body); } catch (e) { return fail(false, "to have a JSON body"); }
          if (path === undefined) return fail(true, "");
          const got = String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), body);
          fail(value === undefined ? got !== undefined : __deepEqual(got, value), "to have JSON " + path + (value === undefined ? "" : " = " + __fmt(value)));
        },
        responseTime: { below: (ms) => fail(r.responseTime < ms, "time below " + ms + "ms") },
      },
    };
    const be = {};
    const statusIs = (name, test) => Object.defineProperty(be, name, { get: () => fail(test(r.status), "to be " + name + " (got " + r.status + ")") });
    statusIs("ok", (c) => c === 200);
    statusIs("success", (c) => c >= 200 && c < 300);
    statusIs("info", (c) => c >= 100 && c < 200);
    statusIs("redirection", (c) => c >= 300 && c < 400);
    statusIs("clientError", (c) => c >= 400 && c < 500);
    statusIs("serverError", (c) => c >= 500);
    statusIs("error", (c) => c >= 400);
    statusIs("accepted", (c) => c === 202);
    statusIs("badRequest", (c) => c === 400);
    statusIs("unauthorized", (c) => c === 401);
    statusIs("forbidden", (c) => c === 403);
    statusIs("notFound", (c) => c === 404);
    statusIs("rateLimited", (c) => c === 429);
    Object.defineProperty(be, "json", { get: () => { try { JSON.parse(r.body); fail(true, ""); } catch (e) { fail(false, "to be JSON"); } } });
    api.be = be;
    api.have.jsonSchema = () => { throw new Error("jsonSchema assertions aren't supported in Reqora scripts"); };
    return api;
  };
  const to = assertions(false);
  to.not = assertions(true);
  return {
    code: r.status,
    status: r.statusText,
    responseTime: r.responseTime,
    responseSize: r.body.length,
    headers: __headerList(r.headers, true),
    json: () => r.json(),
    text: () => r.body,
    to,
  };
})();

const __legacyTests = {};
globalThis.tests = __legacyTests;
globalThis.pm = {
  info: { eventName: __in.response ? "test" : "prerequest", iteration: 0, iterationCount: 1, requestName: "", requestId: "" },
  environment: __envVars,
  collectionVariables: __envVars,
  globals: __envVars,
  variables: __scopeVars,
  iterationData: { get: () => undefined, has: () => false, toObject: () => ({}) },
  request: __pmRequest,
  response: __pmResponse,
  test: Object.assign((name, fn) => rq.test(name, fn), { skip: () => {} }),
  expect: __chai,
  sendRequest: () => { throw new Error("pm.sendRequest isn't available: Reqora scripts have no network access"); },
  cookies: { get: () => undefined, has: () => false, toObject: () => ({}) },
};
globalThis.postman = {
  setEnvironmentVariable: (k, v) => rq.environment.set(k, v),
  getEnvironmentVariable: (k) => rq.environment.get(k),
  clearEnvironmentVariable: (k) => rq.environment.unset(k),
  setGlobalVariable: (k, v) => rq.environment.set(k, v),
  getGlobalVariable: (k) => rq.environment.get(k),
  clearGlobalVariable: (k) => rq.environment.unset(k),
  getResponseHeader: (k) => __pmResponse && __pmResponse.headers.get(k),
};
if (__in.response) {
  globalThis.responseBody = __in.response.body;
  globalThis.responseCode = { code: __in.response.status, name: __in.response.statusText };
  globalThis.responseTime = __in.response.responseTime;
  globalThis.responseHeaders = { ...__in.response.headers };
}

${DEBUG_PRELUDE}
globalThis.__output = () => {
  for (const name of Object.keys(__legacyTests)) __tests.push({ name, passed: Boolean(__legacyTests[name]), ...(__legacyTests[name] ? {} : { error: "tests[" + JSON.stringify(name) + "] was false" }) });
  return JSON.stringify({ request: __request, variables: __variables, logs: __logs, tests: __tests, environment: __envChanges, user: __userChanges, debug: __dbgOutput() });
};
`;

type RunInput = {
  phase: ScriptPhase;
  scripts: ScriptSource[];
  state: ScriptState;
  /** Environment values readable via rq.environment.get — only the names the scripts mention are resolved. */
  readEnv: (name: string) => string | undefined;
  response?: ScriptResponse;
  /** The acting test user (rq.user), and how to read their values — again only names the scripts mention. */
  user?: ScriptUser | null;
  readUser?: (name: string) => string | undefined;
  /** Record each script's run for stepping through (debug runs get a longer time limit). */
  debug?: boolean;
};

/** Debug runs are slower (every statement is recorded). */
const DEBUG_TIME_LIMIT_MS = 5000;

/** Test-user names a script reads (rq.user.get / has, or {{user.NAME}} in itself or the request). */
function userNames(code: string, request?: unknown): string[] {
  const names = new Set<string>();
  for (const m of code.matchAll(/user\.(?:get|has)\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g)) names.add(m[1]);
  const templated = /\{\{\s*user\.([A-Za-z0-9_]+)\s*\}\}/g;
  for (const t of code.matchAll(templated)) names.add(t[1]);
  if (request) for (const t of JSON.stringify(request).matchAll(templated)) names.add(t[1]);
  return [...names];
}

/**
 * " (line 4: x.getPath();)" for the first stack frame inside the user's script — QuickJS messages such as
 * "not a function" don't say where. `code` is the source as given; the async wrapper adds one line before it, and
 * `lineOffset` more (a caller's own wrapper), which aren't counted in the reported line.
 */
export function whereThrown(stack: string | undefined, code: string, file: string, lineOffset = 0): string {
  if (!stack) return "";
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Runtime frames read "at fn (file:L:C)"; syntax errors "at file:L:C".
  const match = new RegExp(`(?:\\(|at )${escaped}:(\\d+)`).exec(stack);
  if (!match) return "";
  const inCode = Number(match[1]) - 1;
  const line = inCode - lineOffset;
  const source = code.split("\n")[inCode - 1]?.trim();
  if (!source || line < 1) return line >= 1 ? ` (line ${line})` : "";
  // QuickJS reports `await` outside an async function as "expecting ';'", which doesn't point at the cause.
  // (A syntax error's stack has no "(file:L)" frame.)
  const syntax = !stack.includes(`(${file}:`);
  const hint = syntax && /\bawait\b/.test(source)
    ? " — await works at the top level of a script or inside an async function, not in a regular callback"
    : "";
  return ` (line ${line}: ${source.length > 120 ? `${source.slice(0, 120)}…` : source})${hint}`;
}

/**
 * Names a script reads via rq.environment.get("NAME") — resolved up front so scripts can't enumerate secrets.
 * replaceIn(…) also gets the names templated in the script and in the request itself ({{NAME}} / {{env.NAME}}),
 * whose values the request sends anyway.
 */
function envNames(code: string, request?: unknown): string[] {
  // pm.variables / collectionVariables / globals / postman.get…Variable read the environment too (Postman resolution).
  const reads = /(?:environment|variables|collectionVariables|globals)\.(?:get|has)\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)|get(?:Environment|Global)Variable\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)|replaceIn\(/g;
  const names = new Set<string>();
  for (const m of code.matchAll(reads)) {
    if (m[1] ?? m[2]) names.add((m[1] ?? m[2])!);
    else {
      const templated = /\{\{\s*(?:env\.)?([A-Za-z0-9_]+)\s*\}\}/g;
      for (const t of code.matchAll(templated)) names.add(t[1]);
      if (request) for (const t of JSON.stringify(request).matchAll(templated)) names.add(t[1]);
    }
  }
  return [...names];
}

/**
 * Runs scripts in order (collection → folder → request), threading request edits and variables through.
 * A pre-request script that throws stops the chain and is returned as `error`; post-response errors are
 * collected and later scripts still run, like Postman.
 */
export async function runScripts({ phase, scripts, state, readEnv, response, user = null, readUser, debug = false }: RunInput): Promise<{
  state: ScriptState;
  errors: ScriptError[];
  /** Debug runs: each script's recorded run. */
  debug?: ScriptDebug[];
}> {
  const engine = await quickjs();
  let current = state;
  const errors: ScriptError[] = [];
  const traces: ScriptDebug[] = [];
  const limitMs = debug ? DEBUG_TIME_LIMIT_MS : TIME_LIMIT_MS;

  for (const source of scripts) {
    if (!source.code.trim()) continue;
    // Debug runs record every statement (probes keep line numbers, so errors still point at the right line).
    const instrumented = debug ? instrumentScript(source.code, source.locals) : null;
    const plain = source.wrap ? source.wrap(source.code) : source.code;
    const script = { ...source, code: plain };
    const runnable = instrumented ? (source.wrap ? source.wrap(instrumented.code) : instrumented.code) : plain;
    const trace: ScriptDebug | null = debug
      ? {
          phase,
          scope: source.scope,
          source: source.name,
          code: source.shown ?? source.code,
          steps: [],
          values: [],
          states: [],
          logs: [],
          ...(instrumented ? {} : { note: "The script has a syntax error, so nothing was recorded — fix it and debug again." }),
        }
      : null;
    if (trace) traces.push(trace);
    // Literal names the script reads, plus everything earlier scripts set (unset names are left out).
    const environment = Object.fromEntries(
      envNames(script.code, current.request).flatMap((name) => {
        const value = name in current.environment ? current.environment[name] : readEnv(name);
        return value === undefined || value === null ? [] : [[name, value]];
      }),
    );
    for (const [name, value] of Object.entries(current.environment)) if (value !== null) environment[name] = value;
    const userChanged = current.user ?? {};
    const userValues: Record<string, string> = user
      ? Object.fromEntries(
          userNames(script.code, current.request).flatMap((name) => {
            const value = name in userChanged ? userChanged[name] : readUser?.(name);
            return value === undefined || value === null ? [] : [[name, value]];
          }),
        )
      : {};
    for (const [name, value] of Object.entries(userChanged)) if (value !== null) userValues[name] = value;

    const runtime = engine.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + limitMs));
    const context = runtime.newContext();
    try {
      const input = context.newString(
        JSON.stringify({
          request: current.request,
          variables: current.variables,
          environment,
          response,
          user,
          userValues,
          random: [...randomBytes(RANDOM_POOL_BYTES)],
          // Lines before the user's code in the evaluated source: the async wrapper, plus any caller wrapper.
          lineOffset: 1 + (script.lineOffset ?? 0),
          debug: instrumented
            ? { points: instrumented.points, maxSteps: DEBUG_MAX_STEPS, maxChars: DEBUG_MAX_CHARS, request: phase === "pre" && !source.wrap }
            : null,
        }),
      );
      context.setProp(context.global, "__input", input);
      input.dispose();
      // crypto.subtle's host side; the prelude takes it off the global object.
      const hostCryptoFn = context.newFunction("__hostCrypto", (opHandle, argsHandle) => {
        const result = hostCrypto(context.getString(opHandle), JSON.parse(context.getString(argsHandle)) as Record<string, unknown>);
        return context.newString(JSON.stringify(result ?? null));
      });
      context.setProp(context.global, "__hostCrypto", hostCryptoFn);
      hostCryptoFn.dispose();

      const fail = (message: string) => {
        errors.push({ phase, scope: script.scope, source: script.name, message });
      };

      const prelude = context.evalCode(PRELUDE, "prelude.js");
      if (prelude.error) {
        fail(`internal: ${JSON.stringify(context.dump(prelude.error))}`);
        prelude.error.dispose();
        break;
      }
      prelude.value.dispose();

      // Libraries the script uses: each UMD bundle sets its global (e.g. CryptoJS), also returned by require().
      let moduleFailed = false;
      for (const name of modulesUsed(script.code)) {
        const { global } = SCRIPT_MODULES[name];
        const loaded = context.evalCode(`${moduleSource(name)}\n;__modules[${JSON.stringify(name)}] = globalThis.${global};`, `${name}.js`);
        if (loaded.error) {
          fail(`could not load ${name}: ${JSON.stringify(context.dump(loaded.error))}`);
          loaded.error.dispose();
          moduleFailed = true;
          break;
        }
        loaded.value.dispose();
      }
      if (moduleFailed) {
        if (phase === "pre") break;
        continue;
      }

      // Wrapped in an async function so top-level `return` and `await` work and user globals don't collide with
      // the prelude. The promise jobs (awaits, crypto.subtle results) run here, still under the CPU deadline.
      const file = `${script.scope}-${phase}.js`;
      const describe = (handle: QuickJSHandle) => {
        const err = context.dump(handle) as { message?: string; name?: string; stack?: string } | string;
        if (typeof err === "string") return err;
        if (err?.message === "interrupted") return `timed out after ${limitMs}ms`;
        return `${err?.name ?? "Error"}: ${err?.message ?? String(err)}${whereThrown(err?.stack, script.code, file, script.lineOffset)}`;
      };
      const result = context.evalCode(`(async function(){\n${runnable}\n})()`, file);
      let threw: string | undefined;
      if (result.error) {
        threw = describe(result.error);
        result.error.dispose();
      } else {
        const promise = result.value;
        while (runtime.hasPendingJob()) {
          const jobs = runtime.executePendingJobs();
          if (jobs.error) {
            threw = describe(jobs.error);
            jobs.error.dispose();
            break;
          }
        }
        const settled = context.getPromiseState(promise);
        if (settled.type === "rejected") {
          threw ??= describe(settled.error);
          settled.error.dispose();
        } else if (settled.type === "fulfilled") {
          settled.value.dispose();
        } else {
          threw ??= "the script finished while still awaiting a promise that never settles";
        }
        promise.dispose();
      }

      // Collect what ran even when the script threw part-way through.
      runtime.setInterruptHandler(() => false);
      const out = context.evalCode("__output()");
      if (out.error) {
        out.error.dispose();
        fail(threw ?? "script output could not be read");
        if (phase === "pre") break;
        continue;
      }
      const parsed = JSON.parse(context.getString(out.value)) as Omit<ScriptState, "logs" | "tests" | "environment" | "user"> & {
        environment: Record<string, unknown>;
        user?: Record<string, unknown>;
        logs: (Omit<ScriptLog, "scope" | "source"> & { step?: number })[];
        tests: Omit<ScriptTest, "scope" | "source">[];
        debug?: { steps: DebugStep[]; values: string; states: string; truncated: boolean } | null;
      };
      out.value.dispose();
      if (trace && parsed.debug) {
        trace.steps = parsed.debug.steps;
        trace.values = JSON.parse(parsed.debug.values) as ScriptDebug["values"];
        trace.states = JSON.parse(parsed.debug.states) as ScriptDebug["states"];
        if (parsed.debug.truncated) trace.truncated = true;
        trace.logs = parsed.logs.map((l): ScriptDebugLog => ({ step: Math.max(0, l.step ?? 0), level: l.level, message: l.message }));
      }
      for (const log of parsed.logs) delete log.step;
      const env = { ...current.environment };
      for (const [name, value] of Object.entries(parsed.environment ?? {})) {
        if (!VARIABLE_NAME.test(name)) {
          threw ??= `rq.environment.set: invalid name "${name.slice(0, 80)}" (letters, digits and _, starting with a letter or _; max 64)`;
        } else if (typeof value === "string" && value.length > MAX_ENV_VALUE) {
          threw ??= `rq.environment.set("${name}"): value is longer than ${MAX_ENV_VALUE} characters`;
        } else {
          env[name] = typeof value === "string" ? value : null;
        }
      }
      const userState = { ...userChanged };
      for (const [name, value] of Object.entries(parsed.user ?? {})) {
        if (!VARIABLE_NAME.test(name)) {
          threw ??= `rq.user.set: invalid name "${name.slice(0, 80)}" (letters, digits and _, starting with a letter or _; max 64)`;
        } else if (typeof value === "string" && value.length > MAX_ENV_VALUE) {
          threw ??= `rq.user.set("${name}"): value is longer than ${MAX_ENV_VALUE} characters`;
        } else {
          userState[name] = typeof value === "string" ? value : null;
        }
      }
      current = {
        environment: env,
        ...(Object.keys(userState).length ? { user: userState } : {}),
        request: phase === "pre" ? sanitizeRequest(parsed.request, current.request) : current.request,
        variables: Object.fromEntries(Object.entries(parsed.variables ?? {}).map(([k, v]) => [k, String(v)])),
        logs: [...current.logs, ...parsed.logs.map((l) => ({ ...l, scope: script.scope, source: script.name }))].slice(-MAX_LOGS),
        tests: [...current.tests, ...parsed.tests.map((t) => ({ ...t, scope: script.scope, source: script.name }))],
      };
      if (threw !== undefined) {
        if (trace) trace.error = { step: Math.max(0, trace.steps.findLastIndex((s) => !s.end)), message: threw };
        fail(threw);
        if (phase === "pre") break;
      }
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }
  return { state: current, errors, ...(debug ? { debug: traces } : {}) };
}

/** Scripts may only change the request through plain strings; anything else keeps the previous value. */
function sanitizeRequest(next: unknown, previous: ScriptRequest): ScriptRequest {
  const r = (next ?? {}) as Partial<ScriptRequest>;
  const headers =
    r.headers && typeof r.headers === "object"
      ? Object.fromEntries(Object.entries(r.headers).filter(([k, v]) => k.trim() && v !== undefined && v !== null).map(([k, v]) => [k, String(v)]))
      : previous.headers;
  const params = Array.isArray(r.params)
    ? r.params.flatMap((p) => (p && typeof p === "object" && String(p.key ?? "").trim() ? [{ key: String(p.key), value: String(p.value ?? "") }] : []))
    : previous.params;
  return {
    method: typeof r.method === "string" && r.method.trim() ? r.method.trim().toUpperCase() : previous.method,
    url: typeof r.url === "string" ? r.url : previous.url,
    params,
    headers,
    body: r.body === undefined || r.body === null ? undefined : String(r.body),
    ...sanitizeForm(r.form, previous),
    ...(previous.file ? { file: previous.file } : {}),
  };
}

/** Form fields stay plain key/value strings; a file field may only point at a file the request already has. */
function sanitizeForm(next: unknown, previous: ScriptRequest): Pick<ScriptRequest, "form" | "formMode"> {
  if (previous.form === undefined) return {};
  const files = new Set(previous.form.filter((f) => f.type === "file").map((f) => f.src));
  const form = Array.isArray(next)
    ? next.flatMap((f) => {
        if (!f || typeof f !== "object" || !String(f.key ?? "").trim()) return [];
        const key = String(f.key);
        if (f.type === "file") return files.has(String(f.src)) ? [{ key, value: "", type: "file" as const, src: String(f.src) }] : [];
        return [{ key, value: String(f.value ?? "") }];
      })
    : previous.form;
  return { form, ...(previous.formMode ? { formMode: previous.formMode } : {}) };
}
