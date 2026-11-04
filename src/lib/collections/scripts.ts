import "server-only";

import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
  newQuickJSWASMModuleFromVariant,
  shouldInterruptAfterDeadline,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
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

let modulePromise: Promise<QuickJSWASMModule> | undefined;
const quickjs = () => (modulePromise ??= newQuickJSWASMModuleFromVariant(variant));

export type ScriptPhase = "pre" | "post";
export type ScriptScope = "collection" | "folder" | "request";
export type ScriptSource = { scope: ScriptScope; name: string; code: string };

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
};

// Runs inside QuickJS. Builds the `rq` API from __input (a JSON string) and exposes __output() for the result.
const PRELUDE = String.raw`
const __in = JSON.parse(__input);
const __logs = [];
const __tests = [];
const __fmt = (v) => {
  if (typeof v === "string") return v;
  if (v === undefined || typeof v === "function" || typeof v === "symbol") return String(v);
  try { return JSON.stringify(v); } catch (e) { return String(v); }
};
const __log = (level) => (...args) => {
  if (__logs.length < ${MAX_LOGS}) __logs.push({ level, message: args.map(__fmt).join(" ").slice(0, ${MAX_LOG_CHARS}) });
};
globalThis.console = { log: __log("log"), info: __log("info"), warn: __log("warn"), error: __log("error") };

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
  },
  test: (name, fn) => {
    try { fn(); __tests.push({ name: String(name), passed: true }); }
    catch (e) { __tests.push({ name: String(name), passed: false, error: String(e && e.message || e) }); }
  },
  expect: __expect,
};
globalThis.__output = () => JSON.stringify({ request: __request, variables: __variables, logs: __logs, tests: __tests });
`;

type RunInput = {
  phase: ScriptPhase;
  scripts: ScriptSource[];
  state: ScriptState;
  /** Environment values readable via rq.environment.get — only the names the scripts mention are resolved. */
  readEnv: (name: string) => string | undefined;
  response?: ScriptResponse;
};

/** Names a script reads via rq.environment.get("NAME") — resolved up front so scripts can't enumerate secrets. */
function envNames(code: string): string[] {
  return [...new Set([...code.matchAll(/environment\.get\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*\)/g)].map((m) => m[1]))];
}

/**
 * Runs scripts in order (collection → folder → request), threading request edits and variables through.
 * A pre-request script that throws stops the chain and is returned as `error`; post-response errors are
 * collected and later scripts still run, like Postman.
 */
export async function runScripts({ phase, scripts, state, readEnv, response }: RunInput): Promise<{
  state: ScriptState;
  errors: ScriptError[];
}> {
  const engine = await quickjs();
  let current = state;
  const errors: ScriptError[] = [];

  for (const script of scripts) {
    if (!script.code.trim()) continue;
    const environment = Object.fromEntries(
      envNames(script.code).flatMap((name) => {
        const value = readEnv(name);
        return value === undefined ? [] : [[name, value]];
      }),
    );

    const runtime = engine.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + TIME_LIMIT_MS));
    const context = runtime.newContext();
    try {
      const input = context.newString(
        JSON.stringify({ request: current.request, variables: current.variables, environment, response }),
      );
      context.setProp(context.global, "__input", input);
      input.dispose();

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

      // Wrapped so top-level `return` works and user globals don't collide with the prelude.
      const result = context.evalCode(`(function(){\n${script.code}\n})()`, `${script.scope}-${phase}.js`);
      let threw: string | undefined;
      if (result.error) {
        const err = context.dump(result.error) as { message?: string; name?: string } | string;
        threw = typeof err === "string" ? err : err?.message === "interrupted" ? `timed out after ${TIME_LIMIT_MS}ms` : `${err?.name ?? "Error"}: ${err?.message ?? String(err)}`;
        result.error.dispose();
      } else {
        result.value.dispose();
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
      const parsed = JSON.parse(context.getString(out.value)) as Omit<ScriptState, "logs" | "tests"> & {
        logs: Omit<ScriptLog, "scope" | "source">[];
        tests: Omit<ScriptTest, "scope" | "source">[];
      };
      out.value.dispose();
      current = {
        request: phase === "pre" ? sanitizeRequest(parsed.request, current.request) : current.request,
        variables: Object.fromEntries(Object.entries(parsed.variables ?? {}).map(([k, v]) => [k, String(v)])),
        logs: [...current.logs, ...parsed.logs.map((l) => ({ ...l, scope: script.scope, source: script.name }))].slice(-MAX_LOGS),
        tests: [...current.tests, ...parsed.tests.map((t) => ({ ...t, scope: script.scope, source: script.name }))],
      };
      if (threw !== undefined) {
        fail(threw);
        if (phase === "pre") break;
      }
    } finally {
      context.dispose();
      runtime.dispose();
    }
  }
  return { state: current, errors };
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
  };
}
