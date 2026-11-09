import type { NodeType } from "./schema";
import { lookup, renderJson, renderString, renderValue, TemplateError, type TemplateContext } from "./template";

/** Something a template can read: the trigger, or an earlier node's output. */
export type DataSource = {
  /** `trigger` or a node id. */
  root: string;
  /** Node name ("Webhook payload" for the trigger). */
  label: string;
  /** `vars`: names Collections scripts set (`{{vars.name}}`). */
  type: NodeType | "trigger" | "vars";
  /** The last run's output, or a sample of the node type's output shape when it hasn't run. */
  value: unknown;
  /** False when `value` is only the type's output shape (the node hasn't run yet). */
  ran: boolean;
};

/** `user`: value names the acting test user has (columns of the Test Users table), when test users exist. */
export type SuggestData = { sources: DataSource[]; env: string[]; user?: string[] };

export type Suggestion = {
  /** The whole reference to put between `{{` and `}}`, e.g. `http-1.body.id` (`http-1.body.` to continue inside). */
  insert: string;
  /** What the list shows (the last part of the path). */
  label: string;
  /** A short description of the value: `"abc"`, `12`, `list · 3 items`… */
  detail: string;
  /** Complete: insert closes the placeholder; otherwise the list continues inside it (objects, lists, `env.`). */
  complete: boolean;
};

export const DYNAMIC_VALUES: [name: string, detail: string][] = [
  ["$guid", "random UUID"],
  ["$timestamp", "Unix seconds"],
  ["$isoTimestamp", "ISO date-time"],
];

/** Output fields of each node type, used before the node has run. */
export function outputShape(type: NodeType | "trigger", config?: unknown): unknown {
  switch (type) {
    case "trigger":
    case "webhook":
      return { body: {}, headers: {} };
    case "http":
      return { status: 200, body: {}, headers: {}, durationMs: 0 };
    case "call":
      return { runId: "", workflowId: "", workflowName: "", version: 1, live: true, status: 200, body: {} };
    case "condition":
      return { result: true };
    case "delay":
      return { delayedMs: 0 };
    case "transform": {
      const output = (config as { output?: Record<string, string> } | undefined)?.output ?? {};
      return Object.fromEntries(Object.keys(output).map((k) => [k, ""]));
    }
    case "script":
      return {};
    case "response":
      return { status: 200, body: {} };
  }
}

const SIMPLE_KEY = /^[^.[\]'"\s{}]+$/;

/** Appends a key to a path: `.key`, or `['key']` when it has dots, spaces or brackets. */
export function joinKey(base: string, key: string): string {
  return SIMPLE_KEY.test(key) ? `${base}.${key}` : `${base}[${JSON.stringify(key).replaceAll('"', "'")}]`;
}

/** A short description of a value for suggestion lists and data trees. */
export function describe(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (Array.isArray(value)) return `list · ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const n = Object.keys(value).length;
    return n ? `{ ${n} field${n === 1 ? "" : "s"} }` : "{ }";
  }
  if (typeof value === "string") return JSON.stringify(value.length > 28 ? `${value.slice(0, 27)}…` : value);
  return String(value);
}

const isContainer = (v: unknown) => v !== null && typeof v === "object";

/** The run-so-far context templates resolve against, built from the sources. */
export function sampleContext(sources: DataSource[], env: (name: string) => string): TemplateContext {
  const trigger = sources.find((s) => s.root === "trigger")?.value as TemplateContext["trigger"] | undefined;
  return {
    trigger: trigger ?? {},
    nodes: Object.fromEntries(sources.filter((s) => s.root !== "trigger").map((s) => [s.root, s.value])),
    env,
    user: (name) => `‹user.${name}›`,
  };
}

/**
 * Where the reference being typed splits into the part already complete (`base`) and the part being typed
 * (`partial`): after the last `.` or `[` outside quotes and brackets. `bracket` is true when the partial follows `[`.
 */
function split(query: string): { base: string; partial: string; bracket: boolean } | null {
  let depth = 0;
  let quote: string | null = null;
  let cut = -1;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "[") {
      if (depth === 0) cut = i;
      depth++;
    } else if (ch === "]") depth = Math.max(0, depth - 1);
    else if (ch === "." && depth === 0) cut = i;
  }
  if (cut < 0) return null;
  // Inside an unfinished [ … ] (a filter being typed): nothing sensible to suggest besides positions.
  if (depth > 0 && !/^\[[-\d*]*$/.test(query.slice(cut))) return { base: query.slice(0, cut), partial: "\u0000", bracket: true };
  return { base: query.slice(0, cut), partial: query.slice(cut + 1), bracket: query[cut] === "[" };
}

/** A suggestion for `path`: a plain value closes the placeholder; an object or list continues into it (`path.`). */
const continuing = (path: string, label: string, detail: string, value: unknown): Suggestion =>
  isContainer(value) ? { insert: `${path}.`, label, detail, complete: false } : { insert: path, label, detail, complete: true };

const starts = (text: string, partial: string) => text.toLowerCase().startsWith(partial.toLowerCase());

/** Suggestions for the reference typed so far after `{{` (`query`, without the braces). */
export function suggest(query: string, data: SuggestData, limit = 60): Suggestion[] {
  const q = query.trimStart();
  const parts = split(q);

  if (!parts) {
    const roots: Suggestion[] = [
      ...data.sources.map((s) => ({
        insert: `${s.root}.`,
        label: s.root,
        detail: s.root === "trigger" ? "webhook payload" : `${s.label}${s.ran ? "" : " · not run yet"}`,
        complete: false,
      })),
      { insert: "env.", label: "env", detail: `environment variables (${data.env.length})`, complete: false },
      ...(data.user?.length ? [{ insert: "user.", label: "user", detail: `acting test user (${data.user.length} values)`, complete: false }] : []),
      ...DYNAMIC_VALUES.map(([name, detail]) => ({ insert: name, label: name, detail, complete: true })),
    ];
    const byName = (s: Suggestion) => starts(s.label, q) || (q.length > 0 && s.detail.toLowerCase().includes(q.toLowerCase()));
    return roots.filter(byName).slice(0, limit);
  }

  const { base, partial, bracket } = parts;
  if (base.trim() === "user" && !bracket) {
    return (data.user ?? [])
      .filter((name) => starts(name, partial))
      .map((name) => ({ insert: `user.${name}`, label: name, detail: "test user value", complete: true }))
      .slice(0, limit);
  }
  if (base.trim() === "env" && !bracket) {
    return data.env
      .filter((name) => starts(name, partial))
      .map((name) => ({ insert: `env.${name}`, label: name, detail: "variable", complete: true }))
      .slice(0, limit);
  }

  let value: unknown;
  try {
    value = lookup(base, sampleContext(data.sources, () => ""));
  } catch {
    return [];
  }
  const out: Suggestion[] = [];
  if (Array.isArray(value)) {
    const positions: [string, string, unknown][] = [
      ["[0]", "first item", value[0]],
      ["[-1]", "last item", value.at(-1)],
      ["[*]", "every item", value],
    ];
    for (const [suffix, what, item] of positions) {
      // After `[`, match what's typed inside it; after `.`, offer positions only until a field name is typed.
      if (bracket ? !starts(suffix.slice(1), partial) : partial !== "") continue;
      out.push(continuing(`${base}${suffix}`, suffix, `${what} · ${describe(item)}`, item));
    }
    if (!bracket) {
      if (starts("length", partial)) out.push({ insert: `${base}.length`, label: "length", detail: `${value.length}`, complete: true });
      // A field name after a list takes it from every item.
      const first = value.find(isContainer);
      if (first && !Array.isArray(first)) {
        for (const [key, v] of Object.entries(first as Record<string, unknown>)) {
          if (starts(key, partial)) {
            out.push({ insert: joinKey(base, key), label: key, detail: `from every item · ${describe(v)}`, complete: true });
          }
        }
      }
    }
  } else if (isContainer(value) && !bracket) {
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (starts(key, partial)) out.push(continuing(joinKey(base, key), key, describe(v), v));
    }
  }
  return out.slice(0, limit);
}

/** The reference being typed at `caret`: the text after an unclosed `{{`, or null when not inside one. */
export function openPlaceholder(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("{{");
  if (start < 0 || before.indexOf("}}", start) >= 0) return null;
  const query = before.slice(start + 2);
  if (query.includes("\n") || query.includes("{") || query.includes("}")) return null;
  return { start, query };
}

export type Preview = { kind: "value"; text: string } | { kind: "error"; text: string } | { kind: "pending"; text: string };

/**
 * What a template resolves to with the last run's data (`{{env.X}}` stays a marker: values aren't sent to the
 * browser). `mode`: "string" for URLs, "json" for bodies, "value" for compared values.
 */
export function preview(template: string, sources: DataSource[], mode: "string" | "json" | "value"): Preview | null {
  if (!template.includes("{{")) return null;
  // A placeholder still being typed: nothing meaningful to show yet.
  if (template.split("{{").length !== template.split("}}").length) return null;
  const notRun = [...template.matchAll(/\{\{\s*([^{}.[\s]+)/g)]
    .map((m) => m[1])
    .filter((root) => sources.some((s) => s.root === root && !s.ran));
  if (notRun.length) return { kind: "pending", text: `${[...new Set(notRun)].join(", ")} hasn't run yet — run the flow to preview` };
  const ctx = sampleContext(sources, (name) => `‹env.${name}›`);
  try {
    const value = mode === "json" ? renderJson(template, ctx) : mode === "value" ? renderValue(template, ctx) : renderString(template, ctx);
    const text = typeof value === "string" && mode !== "json" ? value : JSON.stringify(value);
    return { kind: "value", text: text === undefined || text === "" ? "(empty)" : text };
  } catch (error) {
    return { kind: "error", text: error instanceof TemplateError ? error.message : String(error) };
  }
}
