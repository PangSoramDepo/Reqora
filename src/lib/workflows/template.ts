export class TemplateError extends Error {}

export type TemplateContext = {
  trigger: { body?: unknown; headers?: Record<string, string> };
  /** Outputs of executed nodes, keyed by node id. */
  nodes: Record<string, unknown>;
  /** Resolves `{{env.NAME}}`; should throw TemplateError when the variable is missing. */
  env: (name: string) => string;
};

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE_PLACEHOLDER = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const JSON_STRING_LITERAL = /"(?:[^"\\]|\\.)*"/g;

export function lookup(expr: string, ctx: TemplateContext): unknown {
  const [root, ...path] = expr.split(".");
  if (root === "env") {
    if (path.length !== 1) throw new TemplateError(`invalid env reference "{{${expr}}}"`);
    return ctx.env(path[0]);
  }
  let value: unknown = root === "trigger" ? ctx.trigger : ctx.nodes[root];
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
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

  for (const match of template.matchAll(JSON_STRING_LITERAL)) {
    out += bare(template.slice(last, match.index));
    out += match[0].replace(PLACEHOLDER, (_, expr: string) => JSON.stringify(toText(lookup(expr, ctx))).slice(1, -1));
    last = match.index + match[0].length;
  }
  out += bare(template.slice(last));

  try {
    return JSON.parse(out);
  } catch (error) {
    throw new TemplateError(`body is not valid JSON after interpolation: ${(error as Error).message}`);
  }
}
