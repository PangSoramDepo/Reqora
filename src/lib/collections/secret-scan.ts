import type { WorkflowNode } from "@/lib/workflows/schema";
import type { Auth, CollectionExport, ExportedFolder, KeyValue, ScopeSettings } from "./schema";

/**
 * Looks through an export for values that look like real credentials typed straight into a request (instead of
 * {{env.NAME}} / {{user.NAME}}), so sharing the file doesn't leak them. Heuristic: a credential-like name with a
 * literal value, or a value with a well-known token shape. Templates ({{…}}) are never flagged.
 */

export type SecretFinding = {
  /** Where it is, e.g. `Bank / Auth › Login › Header “Authorization”`. */
  where: string;
  /** Why it was flagged. */
  why: string;
  /** A masked preview of the value (first and last characters). */
  preview: string;
  /** Saved example responses can be left out of the export instead of edited. */
  inExample?: true;
};

/** Credential-like names (headers, params, body fields, script variables). */
const SECRET_NAME = /pass(word|wd)?$|passwd|secret|token|api[-_]?key|apikey|authorization|^auth$|cookie|session|credential|private[-_]?key|^pin$|otp/i;
/** Values with a well-known credential shape, whatever they're called. */
const SECRET_SHAPES: [RegExp, string][] = [
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/, "looks like a JWT"],
  [/\b(?:sk|rk|pk)_live_[\w]{8,}/, "looks like a live API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "looks like a GitHub token"],
  [/\bxox[abpr]-[\w-]{10,}/, "looks like a Slack token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "looks like an AWS access key"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "contains a private key"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/, "a bearer token"],
];
const MIN_LENGTH = 4;

const isTemplate = (value: string) => /\{\{[^{}]+\}\}/.test(value);
const literal = (value: string | undefined) => {
  const v = (value ?? "").trim();
  return v.length >= MIN_LENGTH && !isTemplate(v) ? v : null;
};
export const maskValue = (value: string) => {
  const v = value.replace(/\s+/g, " ");
  return v.length <= 8 ? "•".repeat(v.length) : `${v.slice(0, 3)}•••${v.slice(-3)} (${v.length} chars)`;
};
const shapeOf = (value: string) => SECRET_SHAPES.find(([re]) => re.test(value));

class Scanner {
  readonly findings: SecretFinding[] = [];
  private seen = new Set<string>();

  add(where: string, why: string, value: string, inExample = false) {
    const key = `${where}\u0000${why}`;
    if (this.seen.has(key) || this.findings.length >= 200) return;
    this.seen.add(key);
    this.findings.push({ where, why, preview: maskValue(value), ...(inExample ? { inExample: true as const } : {}) });
  }

  /** A named value: flagged when the name is credential-like and the value literal, or the value has a token shape. */
  named(where: string, name: string, value: string | undefined, inExample = false) {
    const v = literal(value);
    if (!v) return;
    const shape = shapeOf(v);
    if (shape) this.add(where, shape[1], v, inExample);
    else if (SECRET_NAME.test(name)) this.add(where, `“${name}” has a typed-in value — use {{env.${envName(name)}}} or {{user.${envName(name)}}}`, v, inExample);
  }

  /** Free text (URL, raw body, script): only well-known token shapes. */
  text(where: string, value: string | undefined, inExample = false) {
    if (!value) return;
    for (const [re, why] of SECRET_SHAPES) {
      const m = re.exec(value);
      if (m && !isTemplate(m[0])) this.add(where, why, m[0], inExample);
    }
  }

  keyValues(where: string, kind: string, rows: KeyValue[]) {
    for (const row of rows) if (row.key.trim()) this.named(`${where} › ${kind} “${row.key}”`, row.key, row.value);
  }

  auth(where: string, auth: Auth) {
    if (auth.type === "bearer") this.literalAuth(`${where} › Auth (Bearer token)`, auth.token);
    if (auth.type === "basic") this.literalAuth(`${where} › Auth (Basic password)`, auth.password);
    if (auth.type === "apiKey") this.literalAuth(`${where} › Auth (API key “${auth.header}”)`, auth.value);
  }

  private literalAuth(where: string, value: string) {
    const v = literal(value);
    if (v) this.add(where, "typed-in credential — use {{env.NAME}} or {{user.NAME}}", v);
  }

  /** JSON values under credential-like keys (any depth), else token shapes in the text. */
  json(where: string, text: string, inExample = false) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON (or JSON with templates in it): look for "key": "value" pairs and token shapes.
      for (const m of text.matchAll(/"([\w-]{2,64})"\s*:\s*"([^"]*)"/g)) this.named(`${where} › “${m[1]}”`, m[1], m[2], inExample);
      this.text(where, text, inExample);
      return;
    }
    this.walk(where, parsed, inExample, 0);
  }

  walk(where: string, value: unknown, inExample: boolean, depth: number) {
    if (depth > 8 || this.findings.length >= 200) return;
    if (typeof value === "string") return this.text(where, value, inExample);
    if (Array.isArray(value)) return value.slice(0, 200).forEach((v) => this.walk(where, v, inExample, depth + 1));
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value).slice(0, 500)) {
        if (typeof v === "string") this.named(`${where} › “${k}”`, k, v, inExample);
        else this.walk(where, v, inExample, depth + 1);
      }
    }
  }

  /** `const apiKey = "…"`, `password: '…'`, rq.environment.set("token", "…") and token shapes. */
  script(where: string, code: string) {
    if (!code.trim()) return;
    const assign = /([A-Za-z_$][\w$]*)["']?\s*[:=]\s*(["'`])([^"'`\n]*)\2/g;
    for (const m of code.matchAll(assign)) if (SECRET_NAME.test(m[1])) this.named(`${where} › “${m[1]}”`, m[1], m[3]);
    const set = /\.set\(\s*["'`]([\w-]+)["'`]\s*,\s*(["'`])([^"'`\n]*)\2/g;
    for (const m of code.matchAll(set)) this.named(`${where} › “${m[1]}”`, m[1], m[3]);
    this.text(where, code);
  }

  settings(where: string, s: ScopeSettings) {
    this.auth(where, s.auth);
    this.keyValues(where, "Header", s.headers);
    this.script(`${where} › Pre-request script`, s.preScript);
    this.script(`${where} › Post-response script`, s.postScript);
  }
}

/** Variable-style name for a suggestion: "X-Api-Key" → "X_Api_Key". */
const envName = (name: string) => name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");

type ExportedRequest = CollectionExport["collection"]["requests"][number];

function scanRequest(s: Scanner, where: string, r: ExportedRequest) {
  const d = r.definition;
  const at = `${where} › ${r.name}`;
  s.text(`${at} › URL`, d.url);
  s.keyValues(at, "Param", d.params);
  s.keyValues(at, "Header", d.headers);
  s.auth(at, d.auth);
  if (d.body.type === "json") s.json(`${at} › Body`, d.body.text);
  if (d.body.type === "text") s.text(`${at} › Body`, d.body.text);
  if (d.body.type === "urlencoded") s.keyValues(`${at} › Body`, "Field", d.body.fields);
  if (d.body.type === "formdata") {
    for (const f of d.body.fields) if (f.kind === "text" && f.key.trim()) s.named(`${at} › Body › Field “${f.key}”`, f.key, f.value);
  }
  s.script(`${at} › Pre-request script`, d.preScript);
  s.script(`${at} › Post-response script`, d.postScript);
  for (const ex of r.examples) {
    const where = `${at} › Example “${ex.name}”`;
    for (const [k, v] of Object.entries(ex.response.headers)) {
      if (/^set-cookie$/i.test(k) && literal(v)) s.add(`${where} › Header “${k}”`, "a session cookie", v, true);
      else s.named(`${where} › Header “${k}”`, k, v, true);
    }
    const body = ex.response.body;
    if (typeof body === "string") s.json(`${where} › Body`, body, true);
    else s.walk(`${where} › Body`, body, true, 0);
  }
}

function scanFolder(s: Scanner, where: string, f: ExportedFolder) {
  const at = `${where} / ${f.name}`;
  s.settings(`${at} (folder)`, f.settings);
  for (const r of f.requests) scanRequest(s, at, r);
  for (const sub of f.folders ?? []) scanFolder(s, at, sub);
}

/** Likely credentials in a collection export (most 200). */
export function scanCollection(exported: CollectionExport): SecretFinding[] {
  const s = new Scanner();
  const c = exported.collection;
  s.settings(`${c.name} (collection)`, c.settings);
  for (const f of c.folders) scanFolder(s, c.name, f);
  for (const r of c.requests) scanRequest(s, c.name, r);
  return s.findings;
}

/** Drops saved example responses (they hold real response data, e.g. tokens from a login). */
export function withoutExamples(exported: CollectionExport): CollectionExport {
  const strip = (r: ExportedRequest): ExportedRequest => ({ ...r, examples: [] });
  const folder = (f: ExportedFolder): ExportedFolder => ({ ...f, requests: f.requests.map(strip), ...(f.folders ? { folders: f.folders.map(folder) } : {}) });
  const c = exported.collection;
  return { ...exported, collection: { ...c, folders: c.folders.map(folder), requests: c.requests.map(strip) } };
}

type FlowLike = { name: string; nodes: WorkflowNode[] };

/** Likely credentials typed into flows: HTTP steps (URL, headers, body) and scripts. */
export function scanFlows(flows: FlowLike[]): SecretFinding[] {
  const s = new Scanner();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      const at = `Flow “${flow.name}” › ${node.name}`;
      if (node.type === "http") {
        s.text(`${at} › URL`, node.config.url);
        for (const [k, v] of Object.entries(node.config.headers ?? {})) s.named(`${at} › Header “${k}”`, k, v);
        if (typeof node.config.body === "string") s.json(`${at} › Body`, node.config.body);
        if (node.config.repeat?.script) s.script(`${at} › Repeat until script`, node.config.repeat.script);
      }
      if (node.type === "script") s.script(`${at} › Script`, node.config.code);
    }
  }
  return s.findings;
}
