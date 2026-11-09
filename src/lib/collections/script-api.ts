/**
 * A description of the script sandbox's globals (`rq`, `console`), mirroring the prelude in scripts.ts.
 * The script editor uses it for autocompletion, hover docs and lint ("rq has no member …").
 * Keep it in step with PRELUDE when the API changes.
 */

export type ScriptPhase = "pre" | "post";

/** Libraries scripts can require (bundles in SCRIPT_MODULES, scripts.ts). */
export const SCRIPT_MODULE_NAMES = ["crypto-js", "lodash", "moment"] as const;

export type ApiMember = {
  name: string;
  kind: "namespace" | "property" | "method";
  /** Short type or signature, shown next to the completion. */
  detail: string;
  doc: string;
  /** Members of this object (namespace/property), or of the value a method returns. Absent = unknown shape. */
  members?: ApiMember[];
  /** Only available in these phases (default: both). */
  phases?: ScriptPhase[];
  /** The first argument names something checkable: an environment variable, or a module for require(). */
  nameArg?: "env" | "module";
};

const prop = (name: string, detail: string, doc: string, extra: Partial<ApiMember> = {}): ApiMember => ({
  name,
  kind: "property",
  detail,
  doc,
  ...extra,
});
const method = (name: string, detail: string, doc: string, extra: Partial<ApiMember> = {}): ApiMember => ({
  name,
  kind: "method",
  detail,
  doc,
  ...extra,
});

const MATCHER_NAMES: [string, string, string][] = [
  ["toBe", "(expected)", "Strict equality (===)."],
  ["toEqual", "(expected)", "Deep equality (compares JSON)."],
  ["toContain", "(item)", "The string or array contains the item."],
  ["toBeTruthy", "()", "The value is truthy."],
  ["toBeFalsy", "()", "The value is falsy."],
  ["toBeGreaterThan", "(n)", "The value is greater than n."],
  ["toBeLessThan", "(n)", "The value is less than n."],
  ["toHaveProperty", "(key)", "The object has its own property key."],
  ["toMatch", "(regexp)", "String(value) matches the regular expression."],
];
const MATCHERS: ApiMember[] = MATCHER_NAMES.map(([name, sig, doc]) => method(name, sig, doc));
for (const m of MATCHERS) m.members = MATCHERS; // matchers chain: expect(x).toBeTruthy().toBe(1)

const PM_ENV: ApiMember[] = [
  method("get", "(name: string): string | undefined", "Reads a value. Write the name as a string literal: only literal names are resolved.", { nameArg: "env" }),
  method("set", "(name: string, value: any): void", "Sets a value; it is saved to the selected environment after the send.", { nameArg: "env" }),
  method("unset", "(name: string): void", "Removes a value from the selected environment after the send.", { nameArg: "env" }),
  method("has", "(name: string): boolean", "Whether the environment has a value for the name.", { nameArg: "env" }),
  method("replaceIn", "(text: string): string", "Replaces {{name}} with environment values."),
];

const REQUEST_MEMBERS: ApiMember[] = [
  prop("method", "string", "HTTP method, e.g. \"GET\". Pre-request scripts may change it."),
  prop(
    "url",
    "string",
    "URL with {{templates}} still unresolved; query params are in params. Like Postman's url it has getPath(), getHost(), getQueryString() and getPathWithQuery().",
  ),
  prop("params", "{ key, value }[]", "Query parameters (enabled ones only)."),
  prop("headers", "Record<string, string>", "Request headers. Add one with rq.request.headers[\"X-Name\"] = \"value\"."),
  prop("body", "string | undefined", "Raw body text, templates unresolved."),
];

export const SCRIPT_API: ApiMember[] = [
  {
    name: "rq",
    kind: "namespace",
    detail: "Reqora script API",
    doc: "Request, response, variables, environment and tests.",
    members: [
      prop("request", "object", "The request. Editable in pre-request scripts; read-only (as sent) in post-response scripts.", {
        members: REQUEST_MEMBERS,
      }),
      prop("response", "object", "The response. Only in post-response scripts.", {
        phases: ["post"],
        members: [
          prop("status", "number", "HTTP status code, e.g. 200."),
          prop("statusText", "string", "HTTP status text, e.g. \"OK\"."),
          prop("headers", "Record<string, string>", "Response headers (lower-case names)."),
          prop("body", "string", "Raw response body."),
          prop("responseTime", "number", "Time to the response, in milliseconds."),
          method("json", "(): any", "Parses the body as JSON (throws if it isn't)."),
          method("text", "(): string", "The body as text."),
        ],
      }),
      prop("variables", "object", "Request-scoped variables, read in templates as {{vars.NAME}}.", {
        members: [
          method("get", "(name: string): string | undefined", "Reads a variable."),
          method("set", "(name: string, value: any): void", "Sets a variable (stored as a string)."),
          method("unset", "(name: string): void", "Removes a variable."),
          method("toObject", "(): Record<string, string>", "All variables as an object."),
        ],
      }),
      prop("environment", "object", "The selected environment's variables ({{env.NAME}}).", {
        members: [
          method("get", "(name: string): string | undefined", "Reads an environment value. Write the name as a string literal: only literal names are resolved.", {
            nameArg: "env",
          }),
          method("set", "(name: string, value: any): void", "Sets a value; it is saved to the selected environment after the send.", {
            nameArg: "env",
          }),
          method("unset", "(name: string): void", "Removes a value from the selected environment after the send.", { nameArg: "env" }),
          method("has", "(name: string): boolean", "Whether the environment has a value for the name.", { nameArg: "env" }),
          method("replaceIn", "(text: string): string", "Replaces {{NAME}} and {{env.NAME}} with environment values (and {{vars.NAME}} with rq.variables)."),
        ],
      }),
      prop(
        "user",
        "object",
        "The test user this request is sent as (Run as / Send as): their values ({{user.NAME}}). Saving here is how a login request keeps a user's tokens.",
        {
          members: [
            prop("name", "string", "The user's name, e.g. \"maker01\"."),
            prop("roles", "string[]", "The user's role tags, e.g. [\"maker\"]."),
            prop("role", "string", "The flow role they play in this step (\"user\" outside a flow)."),
            method("get", "(name: string): string | undefined", "Reads one of the user's values, e.g. rq.user.get(\"login_id\"). Write the name as a string literal."),
            method(
              "set",
              "(name: string, value: any): void",
              "Saves a value to the user right away, e.g. rq.user.set(\"access_token\", rq.response.json().access_token). New names become columns on the Test Users page.",
            ),
            method("unset", "(name: string): void", "Clears one of the user's values."),
            method("has", "(name: string): boolean", "Whether the user has a value for the name."),
          ],
        },
      ),
      method("test", "(name: string, fn: () => void): void", "A named test. It fails if fn throws (e.g. a failed rq.expect)."),
      method("expect", "(actual: any): Matchers", "Assertion: rq.expect(value).toBe(expected).", { members: MATCHERS }),
    ],
  },
  {
    name: "console",
    kind: "namespace",
    detail: "Console",
    doc: "Writes to the Console tab and the Live Execution Console.",
    members: [
      method("log", "(...values: any[]): void", "Logs values."),
      method("info", "(...values: any[]): void", "Logs at info level."),
      method("warn", "(...values: any[]): void", "Logs at warn level."),
      method("error", "(...values: any[]): void", "Logs at error level."),
    ],
  },
  method("require", '(name: "crypto-js" | "lodash" | "moment"): any', `Loads a built-in library, like Postman. Available: ${SCRIPT_MODULE_NAMES.join(", ")}.`, {
    nameArg: "module",
  }),
  // Members are left open (no lint); the library is large.
  {
    name: "pm",
    kind: "namespace",
    detail: "Postman compatibility",
    doc: "Postman's pm API, mapped onto rq so imported Postman scripts run unchanged.",
    members: [
      prop("environment", "object", "The selected environment (same as rq.environment): get / set / unset / has / replaceIn.", {
        members: PM_ENV,
      }),
      prop("collectionVariables", "object", "Saved to the selected environment in Reqora (there are no collection variables).", {
        members: PM_ENV,
      }),
      prop("globals", "object", "Saved to the selected environment in Reqora (there are no globals).", { members: PM_ENV }),
      prop("variables", "object", "Request-local values (rq.variables), falling back to the environment on get.", {
        members: [
          method("get", "(name: string): string | undefined", "A local variable, else the environment value."),
          method("set", "(name: string, value: any): void", "Sets a local variable ({{vars.NAME}})."),
          method("unset", "(name: string): void", "Removes a local variable."),
          method("has", "(name: string): boolean", "Whether a local or environment value exists."),
          method("toObject", "(): Record<string, string>", "Local variables."),
          method("replaceIn", "(text: string): string", "Replaces {{name}} with variable / environment values."),
        ],
      }),
      prop("request", "object", "The request: url (toString, getHost, getPath, query), method, headers (add, upsert, remove, get), body."),
      prop("response", "object", "The response: code, status, headers.get(), responseTime, json(), text(), to.have.status(), to.be.ok…", {
        phases: ["post"],
      }),
      method("test", "(name: string, fn: () => void): void", "A named test (same as rq.test)."),
      method("expect", "(actual: any): Assertion", "Chai-style assertion: to.equal, to.eql, to.include, to.be.above, to.have.property, to.be.a(\"string\")…"),
      prop("info", "object", "eventName (\"prerequest\" or \"test\"), iteration."),
      method("sendRequest", "(…): never", "Not available: scripts have no network access."),
    ],
  },
  prop("postman", "object", "Legacy Postman API: setEnvironmentVariable, getEnvironmentVariable, clearEnvironmentVariable…"),
  prop("tests", "Record<string, boolean>", "Legacy Postman tests: tests[\"name\"] = condition."),
  method("btoa", "(text: string): string", "Base64-encodes a Latin-1 string."),
  prop("crypto", "Crypto", "Web Crypto: getRandomValues, randomUUID and subtle (async — use await).", {
    members: [
      method("getRandomValues", "(array: TypedArray): TypedArray", "Fills the array with secure random values."),
      method("randomUUID", "(): string", "A random v4 UUID."),
      prop("subtle", "SubtleCrypto", "Async crypto: digest, importKey, exportKey, sign, verify, encrypt, decrypt. Await the results.", {
        members: [
          method("digest", "(algorithm: \"SHA-1\" | \"SHA-256\" | \"SHA-384\" | \"SHA-512\", data: BufferSource): Promise<ArrayBuffer>", "Hashes data."),
          method("importKey", "(format: \"raw\" | \"pkcs8\" | \"spki\" | \"jwk\", keyData, algorithm, extractable: boolean, usages: string[]): Promise<CryptoKey>", "Imports a key: HMAC / AES (raw), RSASSA-PKCS1-v1_5, RSA-PSS, RSA-OAEP, ECDSA, Ed25519 (pkcs8 / spki / jwk)."),
          method("exportKey", "(format, key: CryptoKey): Promise<ArrayBuffer | JsonWebKey>", "Exports an extractable key."),
          method("sign", "(algorithm, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>", "Signs with HMAC, RSASSA-PKCS1-v1_5 (RS256), RSA-PSS, ECDSA or Ed25519."),
          method("verify", "(algorithm, key: CryptoKey, signature: BufferSource, data: BufferSource): Promise<boolean>", "Checks a signature."),
          method("encrypt", "(algorithm, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>", "RSA-OAEP, AES-GCM ({ name, iv }) or AES-CBC ({ name, iv })."),
          method("decrypt", "(algorithm, key: CryptoKey, data: BufferSource): Promise<ArrayBuffer>", "RSA-OAEP, AES-GCM or AES-CBC."),
        ],
      }),
    ],
  }),
  prop("TextEncoder", "class", "new TextEncoder().encode(text): Uint8Array (UTF-8)."),
  prop("TextDecoder", "class", "new TextDecoder().decode(bytes): string (UTF-8)."),
  method("atob", "(base64: string): string", "Decodes base64."),
  prop("responseBody", "string", "Legacy Postman: the response body text.", { phases: ["post"] }),
  prop("responseCode", "{ code, name }", "Legacy Postman: the response status.", { phases: ["post"] }),
  prop("CryptoJS", "crypto-js", "The crypto-js library (also require(\"crypto-js\")): AES, DES, SHA256, HmacSHA256, MD5, enc.Base64/Hex/Utf8, mode, pad…"),
  prop("_", "lodash", "The lodash library (also require(\"lodash\")): get, set, pick, omit, groupBy, sortBy, uniq, isEqual, cloneDeep…"),
  prop("moment", "moment", "The moment date library (also require(\"moment\")): moment().format(\"YYYY-MM-DD\"), add, subtract, diff, unix, toISOString…"),
];

/** Standard globals available in the sandbox (QuickJS): no window, document, fetch or timers. */
export const SANDBOX_GLOBALS = [
  "JSON", "Math", "Date", "Object", "Array", "String", "Number", "Boolean", "RegExp", "Error", "TypeError",
  "Map", "Set", "Promise", "Symbol", "BigInt", "parseInt", "parseFloat", "isNaN", "isFinite",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "undefined", "NaN", "Infinity", "globalThis",
];

/** Browser/Node globals people reach for that don't exist in the sandbox. */
export const UNAVAILABLE_GLOBALS: Record<string, string> = {
  fetch: "There is no network access in scripts.",
  XMLHttpRequest: "There is no network access in scripts.",
  setTimeout: "There are no timers in scripts.",
  setInterval: "There are no timers in scripts.",
  process: "There is no Node.js process in scripts.",
  window: "Scripts don't run in the browser.",
  document: "Scripts don't run in the browser.",
  localStorage: "Scripts don't run in the browser.",
};

/** Whether a member exists in this phase. */
export const inPhase = (m: ApiMember, phase: ScriptPhase) => !m.phases || m.phases.includes(phase);

/**
 * Members available after a path such as ["rq", "expect", "()"] ("()" = the result of calling the previous
 * member). [] gives the globals. Undefined when the shape is unknown (e.g. rq.response.json()).
 */
export function membersAfter(path: string[]): ApiMember[] | undefined {
  if (path.length === 0) return SCRIPT_API;
  if (path[path.length - 1] === "()") {
    const callee = memberAt(path.slice(0, -1));
    return callee?.kind === "method" ? callee.members : undefined;
  }
  const m = memberAt(path);
  return m && m.kind !== "method" ? m.members : undefined;
}

/** The member a path names (e.g. ["rq", "environment", "get"]), if known. */
export function memberAt(path: string[]): ApiMember | undefined {
  if (path.length === 0) return undefined;
  return membersAfter(path.slice(0, -1))?.find((m) => m.name === path[path.length - 1]);
}

/** Closest name within edit distance 2, for "did you mean" hints. */
export function closest(name: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = distance(name.toLowerCase(), c.toLowerCase());
    if (d < bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}
