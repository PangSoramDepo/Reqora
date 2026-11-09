import { parser } from "@lezer/javascript";
import type { SyntaxNode } from "@lezer/common";

/**
 * Script debugging by recording: a debug run marks every statement with a probe that records the line and the
 * values of the variables in scope, and the run is stepped through afterwards (forward and back, breakpoints,
 * `debugger;`). Nothing pauses, so a debug run can't hold a request or a flow open.
 */

/** A recorded value, bounded in size. Plain JSON values are themselves; everything else is tagged. */
export type DebugValue =
  | string
  | number
  | boolean
  | null
  | { t: "undefined" }
  | { t: "number"; v: string }
  | { t: "bigint"; v: string }
  | { t: "symbol"; v: string }
  | { t: "function"; name: string }
  | { t: "string"; v: string; length: number }
  | { t: "date"; v: string }
  | { t: "error"; name: string; message: string }
  | { t: "circular" }
  | { t: "getter" }
  /** Nested too deep or past the size budget: only the kind and size are known. */
  | { t: "more"; kind: "array" | "object"; size?: number }
  | { t: "array"; cls?: string; length: number; items: DebugValue[] }
  | { t: "object"; cls?: string; entries: [string, DebugValue][]; more?: number };

/** What the script's rq calls had changed so far. */
export type DebugState = {
  /** rq.environment.set / unset so far (null = unset). */
  environment: Record<string, string | null>;
  /** rq.user.set / unset so far (null = unset). */
  user: Record<string, unknown>;
  /** rq.variables. */
  variables: Record<string, unknown>;
  /** The request as the pre-request script has edited it. */
  request?: unknown;
};

export type DebugStep = {
  /** 1-based line in the script as written. */
  line: number;
  /** Variable name → index into ScriptDebug.values. */
  vars: Record<string, number>;
  /** Index into ScriptDebug.states. */
  state: number;
  /** A `debugger;` statement: Continue stops here like at a breakpoint. */
  pause?: true;
  /** The script ran to its end (or stopped): the final rq changes. */
  end?: true;
};

export type ScriptDebugLog = { step: number; level: "log" | "info" | "warn" | "error"; message: string };

/** One script's recorded run. */
export type ScriptDebug = {
  phase: "pre" | "post";
  scope: "collection" | "folder" | "request";
  /** The script's name (collection / folder / request name, "script node", …). */
  source: string;
  /** The code as written: step lines point into it. */
  code: string;
  steps: DebugStep[];
  /** Distinct recorded values; steps point into this. */
  values: DebugValue[];
  states: DebugState[];
  logs: ScriptDebugLog[];
  /** The script threw: the message, and the step it threw at (usually the last). */
  error?: { step: number; message: string };
  /** Recording stopped early (too many steps or too much data); the script itself still ran to the end. */
  truncated?: boolean;
  /** Why nothing was recorded (e.g. a syntax error). */
  note?: string;
};

export type DebugPoint = { line: number; names: string[]; pause?: true };

/** Steps recorded per script, and the total size of recorded values (characters of JSON). */
export const DEBUG_MAX_STEPS = 2000;
export const DEBUG_MAX_CHARS = 1_500_000;

const BLOCKS = new Set(["Script", "Block", "SwitchBody"]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunction", "MethodDeclaration"]);
const FOR_SPECS = new Set(["ForSpec", "ForInSpec", "ForOfSpec"]);
// Statements that do nothing when reached (a function declaration is hoisted).
const SILENT = new Set(["FunctionDeclaration", "EmptyStatement", "ImportDeclaration", "ExportDeclaration"]);
const STATEMENT = /Statement$|^VariableDeclaration$|^ClassDeclaration$/;

const probe = (id: number) => `__dbg(${id},(__n)=>eval(__n));`;

function upTo(node: SyntaxNode | null, names: Set<string>): SyntaxNode | null {
  for (let n = node; n; n = n.parent) if (names.has(n.name)) return n;
  return null;
}

/** The node a declared name is visible in. */
function scopeOf(def: SyntaxNode, top: SyntaxNode): SyntaxNode {
  const parent = def.parent!;
  // A function's or class's own name: visible around the declaration (or inside an expression).
  if (parent.name === "FunctionDeclaration" || parent.name === "ClassDeclaration") return upTo(parent.parent, BLOCKS) ?? top;
  if (parent.name === "FunctionExpression" || parent.name === "ClassExpression") return parent;
  for (let n: SyntaxNode | null = parent; n; n = n.parent) {
    if (n.name === "ParamList") return n.parent ?? top;
    if (n.name === "CatchClause") return n;
    if (FOR_SPECS.has(n.name)) return n.parent ?? top;
    if (n.name === "VariableDeclaration") {
      if (n.firstChild?.name === "var") return upTo(n.parent, FUNCTIONS) ?? top;
      return upTo(n.parent, new Set([...BLOCKS, ...FUNCTIONS])) ?? top;
    }
    if (n.name === "ArrowFunction" && n.firstChild?.name === "VariableDefinition") return n; // x => …
  }
  return top;
}

/**
 * Adds a probe before every statement in a block, without changing line numbers (so error lines still match),
 * plus one after the script's last statement. `locals`: names defined around the code by a wrapper (e.g. a
 * Script node's `trigger` and `nodes`), recorded at every step. Returns null when the code doesn't parse — it
 * then runs unrecorded and reports its syntax error as usual.
 */
export function instrumentScript(code: string, locals: string[] = []): { code: string; points: DebugPoint[] } | null {
  const tree = parser.parse(code);
  let broken = false;
  tree.iterate({
    enter: (n) => {
      if (n.type.isError) broken = true;
      return !broken;
    },
  });
  if (broken) return null;

  const top = tree.topNode;
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const defs: { name: string; from: number; to: number; at: number }[] = [];
  const statements: SyntaxNode[] = [];
  tree.iterate({
    enter: (ref) => {
      const node = ref.node;
      if (ref.name === "VariableDefinition") {
        const name = code.slice(ref.from, ref.to);
        if (!name.startsWith("__")) {
          const scope = scopeOf(node, top);
          defs.push({ name, from: scope.from, to: scope.to, at: ref.from });
        }
      } else if (STATEMENT.test(ref.name) && !SILENT.has(ref.name) && node.parent && BLOCKS.has(node.parent.name)) {
        statements.push(node);
      }
    },
  });

  const namesAt = (pos: number) => {
    const names = new Set(locals);
    for (const d of defs.sort((a, b) => a.at - b.at)) if (d.from <= pos && pos <= d.to) names.add(d.name);
    return [...names];
  };

  const points: DebugPoint[] = [];
  const inserts: { at: number; text: string }[] = [];
  for (const s of statements) {
    const id = points.length;
    points.push({ line: lineAt(s.from), names: namesAt(s.from), ...(s.name === "DebuggerStatement" ? { pause: true as const } : {}) });
    inserts.push({ at: s.from, text: probe(id) });
  }
  // After the last top-level statement, so the final values show (unless it returned or threw).
  const last = statements.filter((s) => s.parent?.name === "Script").at(-1);
  if (last && last.name !== "ReturnStatement" && last.name !== "ThrowStatement") {
    const id = points.length;
    points.push({ line: lineAt(Math.max(last.from, last.to - 1)), names: namesAt(last.to) });
    inserts.push({ at: last.to, text: `;${probe(id)}` });
  }

  let out = "";
  let pos = 0;
  for (const ins of inserts.sort((a, b) => a.at - b.at)) {
    out += code.slice(pos, ins.at) + ins.text;
    pos = ins.at;
  }
  return { code: out + code.slice(pos), points };
}

/** Recorder side, run inside the sandbox (part of the prelude). Reads __in.debug = { points, maxSteps, maxChars, request }. */
export const DEBUG_PRELUDE = String.raw`
const __dbgIn = __in.debug || null;
const __dbgSteps = [];
const __dbgValues = [];
const __dbgValueIds = new Map();
const __dbgStates = [];
let __dbgStateKey = null;
let __dbgChars = 0;
let __dbgCut = false;
const __dbgBudget = { n: 0 };
const __snap = (v, depth, seen) => {
  if (v === null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : { t: "number", v: String(v) };
  if (typeof v === "string") return v.length > 1000 ? { t: "string", v: v.slice(0, 1000), length: v.length } : v;
  if (v === undefined) return { t: "undefined" };
  if (typeof v === "bigint") return { t: "bigint", v: String(v) };
  if (typeof v === "symbol") return { t: "symbol", v: String(v) };
  if (typeof v === "function") return { t: "function", name: v.name || "" };
  if (seen.includes(v)) return { t: "circular" };
  if (v instanceof Date) return { t: "date", v: isNaN(v.getTime()) ? "Invalid Date" : v.toISOString() };
  if (__isError(v)) return { t: "error", name: String(v.name || "Error"), message: String(v.message) };
  const isArray = Array.isArray(v) || ArrayBuffer.isView(v) || v instanceof Set;
  const size = Array.isArray(v) || ArrayBuffer.isView(v) ? v.length : v instanceof Set || v instanceof Map ? v.size : undefined;
  if (depth >= 5 || __dbgBudget.n <= 0) return { t: "more", kind: isArray ? "array" : "object", ...(size === undefined ? {} : { size }) };
  seen.push(v);
  try {
    const proto = Object.getPrototypeOf(v);
    const ctor = proto && proto !== Object.prototype && proto !== Array.prototype && proto.constructor ? proto.constructor.name : undefined;
    const cls = ctor ? { cls: ctor } : {};
    if (isArray) {
      const all = v instanceof Set ? [...v] : Array.from(v);
      const items = [];
      for (const x of all.slice(0, 100)) { __dbgBudget.n--; items.push(__snap(x, depth + 1, seen)); }
      return { t: "array", ...cls, length: all.length, items };
    }
    const keys = v instanceof Map ? [...v.keys()] : Object.keys(v);
    const entries = [];
    for (const k of keys.slice(0, 100)) {
      __dbgBudget.n--;
      if (v instanceof Map) { entries.push([String(k), __snap(v.get(k), depth + 1, seen)]); continue; }
      const d = Object.getOwnPropertyDescriptor(v, k);
      entries.push([k, d && d.get ? { t: "getter" } : __snap(d ? d.value : undefined, depth + 1, seen)]);
    }
    return { t: "object", ...cls, entries, ...(keys.length > 100 ? { more: keys.length - 100 } : {}) };
  } finally {
    seen.pop();
  }
};
const __dbgValue = (v) => {
  __dbgBudget.n = 800;
  let text;
  try { text = JSON.stringify(__snap(v, 0, [])); } catch (e) { text = JSON.stringify({ t: "error", name: "Error", message: "could not be recorded" }); }
  let id = __dbgValueIds.get(text);
  if (id === undefined) {
    id = __dbgValues.length;
    __dbgValues.push(text);
    __dbgValueIds.set(text, id);
    __dbgChars += text.length;
  }
  return id;
};
const __dbgState = () => {
  const s = { environment: __envChanges, user: __userChanges, variables: __variables };
  if (__dbgIn && __dbgIn.request) s.request = __request;
  let key;
  try { key = JSON.stringify(s); } catch (e) { key = "{}"; }
  if (key !== __dbgStateKey) { __dbgStateKey = key; __dbgStates.push(key); __dbgChars += key.length; }
  return __dbgStates.length - 1;
};
globalThis.__dbg = (id, ev) => {
  if (!__dbgIn || __dbgCut) return;
  if (__dbgSteps.length >= __dbgIn.maxSteps || __dbgChars > __dbgIn.maxChars) { __dbgCut = true; return; }
  const p = __dbgIn.points[id];
  const vars = {};
  for (const n of p.names) {
    let v;
    try { v = ev(n); } catch (e) { continue; } // not declared yet (let/const before its line)
    vars[n] = __dbgValue(v);
  }
  __dbgSteps.push({ line: p.line, vars, state: __dbgState(), ...(p.pause ? { pause: true } : {}) });
};
const __dbgStep = () => __dbgSteps.length - 1;
const __dbgOutput = () => {
  if (!__dbgIn) return null;
  const last = __dbgSteps[__dbgSteps.length - 1];
  if (last) __dbgSteps.push({ line: last.line, vars: last.vars, state: __dbgState(), end: true });
  return { steps: __dbgSteps, values: "[" + __dbgValues.join(",") + "]", states: "[" + __dbgStates.join(",") + "]", truncated: __dbgCut };
};
`;
