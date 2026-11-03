import { parse as parseYaml } from "yaml";
import { ImportError } from "./curl";
import { emptyDefinition, type KeyValue, type RequestDefinition, type RequestMethod } from "./schema";

export type ImportedRequest = { name: string; definition: RequestDefinition };
export type ImportedCollection = {
  name: string;
  description?: string;
  folders: { name: string; requests: ImportedRequest[] }[];
  /** Operations without tags. */
  requests: ImportedRequest[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

const METHODS: RequestMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const MAX_OPERATIONS = 500;

function parseDocument(text: string): Obj {
  let doc: unknown;
  const trimmed = text.trim();
  try {
    doc = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed, { maxAliasCount: 100 });
  } catch (error) {
    throw new ImportError(`could not parse the document as JSON or YAML: ${(error as Error).message}`);
  }
  if (!isObj(doc) || (!("openapi" in doc) && !("swagger" in doc))) {
    throw new ImportError("not an OpenAPI document (missing `openapi` or `swagger` field)");
  }
  if (!isObj(doc.paths)) throw new ImportError("the document has no `paths`");
  return doc;
}

/** Follows local `#/…` references (with a depth guard against cycles). */
function deref(doc: Obj, value: unknown, depth = 0): unknown {
  if (!isObj(value) || typeof value.$ref !== "string") return value;
  if (depth > 20 || !value.$ref.startsWith("#/")) return undefined;
  let target: unknown = doc;
  for (const raw of value.$ref.slice(2).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isObj(target)) return undefined;
    target = target[key];
  }
  return deref(doc, target, depth + 1);
}

function baseUrl(doc: Obj): string {
  if (Array.isArray(doc.servers) && isObj(doc.servers[0]) && typeof doc.servers[0].url === "string") {
    const server = doc.servers[0];
    let url = server.url as string;
    if (isObj(server.variables)) {
      for (const [name, variable] of Object.entries(server.variables)) {
        if (isObj(variable) && variable.default !== undefined) url = url.split(`{${name}}`).join(String(variable.default));
      }
    }
    return url.replace(/\/+$/, "");
  }
  if (typeof doc.host === "string") {
    const scheme = Array.isArray(doc.schemes) && typeof doc.schemes[0] === "string" ? doc.schemes[0] : "https";
    return `${scheme}://${doc.host}${typeof doc.basePath === "string" ? doc.basePath : ""}`.replace(/\/+$/, "");
  }
  return "";
}

function exampleValue(param: Obj): string {
  const schema = isObj(param.schema) ? param.schema : {};
  const v = param.example ?? schema.example ?? schema.default ?? param.default;
  if (v === undefined) return "";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function jsonBodyExample(doc: Obj, op: Obj): string | undefined {
  const body = deref(doc, op.requestBody);
  if (isObj(body) && isObj(body.content)) {
    const entry = Object.entries(body.content).find(([type]) => type.includes("json"));
    if (!entry) return undefined;
    const media = isObj(entry[1]) ? entry[1] : {};
    let example: unknown = media.example;
    if (example === undefined && isObj(media.examples)) {
      const first = deref(doc, Object.values(media.examples)[0]);
      if (isObj(first)) example = first.value;
    }
    if (example === undefined) {
      const schema = deref(doc, media.schema);
      if (isObj(schema)) example = schema.example;
    }
    return example === undefined ? "{}" : JSON.stringify(example, null, 2);
  }
  // Swagger 2.0 body parameter.
  if (Array.isArray(op.parameters)) {
    const bodyParam = op.parameters.map((p) => deref(doc, p)).find((p) => isObj(p) && p.in === "body");
    if (isObj(bodyParam)) {
      const schema = deref(doc, bodyParam.schema);
      return isObj(schema) && schema.example !== undefined ? JSON.stringify(schema.example, null, 2) : "{}";
    }
  }
  return undefined;
}

/** `/pets/{petId}` → `/pets/{{petId}}` */
export const convertPathParams = (path: string) => path.replace(/\{([^{}/]+)\}/g, "{{$1}}");

export function importOpenApi(text: string): ImportedCollection {
  const doc = parseDocument(text);
  const info = isObj(doc.info) ? doc.info : {};
  const base = baseUrl(doc);
  const folders = new Map<string, ImportedRequest[]>();
  const loose: ImportedRequest[] = [];
  let count = 0;

  for (const [path, rawItem] of Object.entries(doc.paths as Obj)) {
    const item = deref(doc, rawItem);
    if (!isObj(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];

    for (const method of METHODS) {
      const op = item[method.toLowerCase()];
      if (!isObj(op)) continue;
      if (++count > MAX_OPERATIONS) throw new ImportError(`too many operations (max ${MAX_OPERATIONS})`);

      const def = emptyDefinition();
      def.method = method;
      def.url = `${base}${convertPathParams(path)}`;

      // Operation-level parameters override path-level ones with the same name+location.
      const params = new Map<string, Obj>();
      for (const raw of [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])]) {
        const p = deref(doc, raw);
        if (isObj(p) && typeof p.name === "string") params.set(`${p.in}:${p.name}`, p);
      }
      const query: KeyValue[] = [];
      const headers: KeyValue[] = [];
      for (const p of params.values()) {
        const kv = { key: p.name as string, value: exampleValue(p), enabled: p.required === true };
        if (p.in === "query") query.push(kv);
        if (p.in === "header") headers.push({ ...kv, enabled: true });
      }
      def.params = query;
      def.headers = headers;

      if (method !== "GET" && method !== "HEAD") {
        const example = jsonBodyExample(doc, op);
        if (example !== undefined) def.body = { type: "json", text: example };
      }

      const name = String(op.summary || op.operationId || `${method} ${path}`).slice(0, 120);
      const request = { name, definition: def };
      const tag = Array.isArray(op.tags) && typeof op.tags[0] === "string" ? op.tags[0] : undefined;
      if (tag) folders.set(tag, [...(folders.get(tag) ?? []), request]);
      else loose.push(request);
    }
  }

  const title = typeof info.title === "string" && info.title.trim() ? info.title.trim() : "Imported API";
  const description = typeof info.description === "string" ? info.description.slice(0, 2000) : undefined;
  return {
    name: title.slice(0, 120),
    ...(description ? { description } : {}),
    folders: [...folders].map(([name, requests]) => ({ name: name.slice(0, 120), requests })),
    requests: loose,
  };
}
