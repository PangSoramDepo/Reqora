export class TemplateError extends Error {}

/** The template resolved, but the result isn't valid JSON. */
export class InvalidJsonError extends TemplateError {}

export type TemplateContext = {
  trigger: { body?: unknown; headers?: Record<string, string> };
  /** Outputs of executed nodes, keyed by node id. */
  nodes: Record<string, unknown>;
  /** Resolves `{{env.NAME}}`; should throw TemplateError when the variable is missing. */
  env: (name: string) => string;
  /** Resolves `{{user.NAME}}` from the test user acting now; absent when no user is acting. */
  user?: (name: string) => string;
};

/** Why `{{user.…}}` can't resolve when no test user acts in a step or send. */
export const NO_USER = "no test user is acting here: add test users on the Secrets page (Test Users), then pick one under Run as / Send as";

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
/** A placeholder, or a JSON string literal (placeholders inside it are kept whole, quotes and all). */
const JSON_TOKEN = /\{\{[^{}]*\}\}|"(?:\{\{[^{}]*\}\}|[^"\\]|\\.)*"/g;

/** Dynamic values, fresh on every use: `{{$guid}}`, `{{$timestamp}}` (Unix seconds), `{{$isoTimestamp}}`. */
const DYNAMIC: Record<string, () => string | number> = {
  $guid: () => crypto.randomUUID(),
  $timestamp: () => Math.floor(Date.now() / 1000),
  $isoTimestamp: () => new Date().toISOString(),
};

type FilterOp = "==" | "=" | "!=" | ">=" | "<=" | ">" | "<";
const QUOTED = /^(['"])[\s\S]*\1$/;

/** One step of a reference path after the root (`trigger`, a node id…). */
type Segment =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "all" }
  | { kind: "filter"; field: string[]; op: FilterOp; value: string };

const FILTER = /^([^=!<>]+?)\s*(==|=|!=|>=|<=|>|<)\s*(.*)$/;
const unquote = (text: string) => (QUOTED.test(text) ? text.slice(1, -1) : text);

/**
 * Splits a reference into its root and path. Besides `.key` steps, a path takes brackets:
 * `[0]` / `[-1]` (item by position), `[*]` (every item), `['a.b']` (a key with dots) and
 * `[field = value]` (items whose field matches; also == != > >= < <=, and `a.b` paths in the field).
 */
function parsePath(expr: string): { root: string; path: Segment[] } {
  const invalid = (why: string) => new TemplateError(`invalid reference "{{${expr}}}": ${why}`);
  const readKey = (from: number) => {
    let end = from;
    while (end < expr.length && expr[end] !== "." && expr[end] !== "[") end++;
    return end;
  };
  let i = readKey(0);
  const root = expr.slice(0, i).trim();
  const path: Segment[] = [];
  while (i < expr.length) {
    if (expr[i] === ".") {
      const end = readKey(i + 1);
      const key = expr.slice(i + 1, end).trim();
      if (!key) throw invalid("empty field name");
      path.push({ kind: "key", key });
      i = end;
      continue;
    }
    // "[": find the closing bracket, skipping quoted text.
    let end = i + 1;
    let quote = "";
    for (; end < expr.length; end++) {
      const c = expr[end];
      if (quote) {
        if (c === quote) quote = "";
      } else if (c === "'" || c === '"') quote = c;
      else if (c === "]") break;
    }
    if (end >= expr.length) throw invalid("missing ]");
    const inner = expr.slice(i + 1, end).trim();
    const filter = FILTER.exec(inner);
    if (inner === "*") path.push({ kind: "all" });
    else if (/^-?\d+$/.test(inner)) path.push({ kind: "index", index: Number(inner) });
    else if (QUOTED.test(inner)) path.push({ kind: "key", key: inner.slice(1, -1) });
    else if (filter && !/^['"]/.test(filter[1])) {
      path.push({ kind: "filter", field: filter[1].trim().split("."), op: filter[2] as FilterOp, value: unquote(filter[3].trim()) });
    } else throw invalid(`"[${inner}]" isn't a position, [*], a quoted key or a filter like [field = value]`);
    i = end + 1;
  }
  return { root, path };
}

/** Template values are often strings ("500") compared to numbers (500); treat those as equal. */
export function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

function matches(actual: unknown, op: FilterOp, expected: string): boolean {
  if (op === "=" || op === "==") return looseEquals(actual, expected);
  if (op === "!=") return !looseEquals(actual, expected);
  if (actual === null || actual === undefined || actual === "" || expected === "") return false;
  const a = Number(actual);
  const b = Number(expected);
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return op === ">" ? a > b : op === ">=" ? a >= b : op === "<" ? a < b : a <= b;
}

const field = (value: unknown, key: string): unknown =>
  value !== null && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;

function step(value: unknown, segment: Segment): unknown {
  switch (segment.kind) {
    case "key":
      // A field name after a list takes that field from every item (a list's own `length` and positions stay).
      if (Array.isArray(value) && segment.key !== "length" && !/^\d+$/.test(segment.key)) {
        return value.map((item) => field(item, segment.key)).filter((v) => v !== undefined);
      }
      return field(value, segment.key);
    case "index":
      return Array.isArray(value) ? value.at(segment.index) : undefined;
    case "all":
      if (Array.isArray(value)) return value;
      return value !== null && typeof value === "object" ? Object.values(value) : undefined;
    case "filter":
      if (!Array.isArray(value)) return undefined;
      return value.filter((item) => matches(segment.field.reduce(field, item), segment.op, segment.value));
  }
}

export function lookup(expr: string, ctx: TemplateContext): unknown {
  const { root, path } = parsePath(expr);
  if (root.startsWith("$")) {
    const dynamic = DYNAMIC[root];
    if (!dynamic || path.length) throw new TemplateError(`unknown dynamic value "{{${expr}}}"`);
    return dynamic();
  }
  if (root === "user") {
    if (path.length !== 1 || path[0].kind !== "key") throw new TemplateError(`invalid user reference "{{${expr}}}"`);
    if (!ctx.user) throw new TemplateError(`{{${expr}}} needs a test user, but ${NO_USER}`);
    return ctx.user(path[0].key);
  }
  if (root === "env") {
    if (path.length !== 1 || path[0].kind !== "key") throw new TemplateError(`invalid env reference "{{${expr}}}"`);
    return ctx.env(path[0].key);
  }
  return path.reduce(step, root === "trigger" ? ctx.trigger : ctx.nodes[root]);
}

function toText(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Interpolates placeholders into a plain string (URLs, header values). */
export function renderString(template: string, ctx: TemplateContext): string {
  return template.replace(PLACEHOLDER, (_, expr: string) => toText(lookup(expr, ctx)));
}

/**
 * Resolves a value template. A template that is exactly one placeholder keeps the referenced value's
 * type (number, object…); anything else renders to a string.
 */
export function renderValue(template: string, ctx: TemplateContext): unknown {
  const whole = WHOLE_PLACEHOLDER.exec(template);
  return whole ? lookup(whole[1], ctx) : renderString(template, ctx);
}

/**
 * Interpolates a JSON document template and parses it. Placeholders inside string literals are inserted
 * as escaped string content; bare placeholders are inserted as JSON values.
 */
export function renderJson(template: string, ctx: TemplateContext): unknown {
  let out = "";
  let last = 0;
  const bare = (segment: string) =>
    segment.replace(PLACEHOLDER, (_, expr: string) => JSON.stringify(lookup(expr, ctx) ?? null));

  for (const match of template.matchAll(JSON_TOKEN)) {
    if (!match[0].startsWith('"')) continue; // a bare placeholder: rendered with its segment below
    out += bare(template.slice(last, match.index));
    out += match[0].replace(PLACEHOLDER, (_, expr: string) => JSON.stringify(toText(lookup(expr, ctx))).slice(1, -1));
    last = match.index + match[0].length;
  }
  out += bare(template.slice(last));

  try {
    return JSON.parse(out);
  } catch (error) {
    throw new InvalidJsonError(`body is not valid JSON after interpolation: ${(error as Error).message}`);
  }
}
