/**
 * A description of the script sandbox's globals (`rq`, `console`), mirroring the prelude in scripts.ts.
 * The script editor uses it for autocompletion, hover docs and lint ("rq has no member …").
 * Keep it in step with PRELUDE when the API changes.
 */

export type ScriptPhase = "pre" | "post";

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
  /** Methods whose first argument is an environment variable name. */
  envNameArg?: boolean;
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

const REQUEST_MEMBERS: ApiMember[] = [
  prop("method", "string", "HTTP method, e.g. \"GET\". Pre-request scripts may change it."),
  prop("url", "string", "URL with {{templates}} still unresolved; query params are in params."),
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
            envNameArg: true,
          }),
          method("set", "(name: string, value: any): void", "Sets a value; it is saved to the selected environment after the send.", {
            envNameArg: true,
          }),
          method("unset", "(name: string): void", "Removes a value from the selected environment after the send.", { envNameArg: true }),
          method("has", "(name: string): boolean", "Whether the environment has a value for the name.", { envNameArg: true }),
        ],
      }),
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
  require: "Modules can't be loaded in scripts.",
  process: "There is no Node.js process in scripts.",
  window: "Scripts don't run in the browser.",
  document: "Scripts don't run in the browser.",
  localStorage: "Scripts don't run in the browser.",
  pm: "Use rq instead of pm (rq.request, rq.response, rq.environment, rq.test, rq.expect).",
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
