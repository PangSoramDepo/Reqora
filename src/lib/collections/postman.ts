import { ImportError } from "./curl";
import type { ImportedCollection, ImportedRequest } from "./openapi";
import {
  emptyDefinition,
  emptyScopeSettings,
  REQUEST_METHODS,
  type Assertion,
  type Auth,
  type CollectionExport,
  type ExampleResponse,
  type KeyValue,
  type RequestDefinition,
  type RequestMethod,
  type ScopeSettings,
} from "./schema";

/**
 * Postman Collection v2.0 / v2.1 import and export.
 *
 * Import: folders (nested ones are flattened as "Parent / Child", inheriting the parent's auth and scripts),
 * requests, auth, headers, query params, raw/urlencoded/GraphQL bodies, pre-request and test scripts (they run
 * through Reqora's `pm` compatibility layer) and saved responses. `{{name}}` becomes `{{env.name}}`, or
 * `{{vars.name}}` when the collection's scripts set it with `pm.variables.set`.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export type PostmanImport = ImportedCollection & {
  /** Collection variables with their values, to add to an environment. */
  variables: { name: string; value: string; secret: boolean }[];
  notes: string[];
};

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const safeName = (name: string) => {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 64);
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`.slice(0, 64);
};

/** Names the collection's scripts store with pm.variables.set (request-scoped → {{vars.x}}). */
function localVariableNames(scripts: string[]): Set<string> {
  const names = new Set<string>();
  for (const code of scripts) {
    for (const m of code.matchAll(/pm\.variables\.set\(\s*["'`]([^"'`]+)["'`]/g)) names.add(m[1]);
  }
  return names;
}

function scriptsOf(node: Obj): { pre: string; post: string } {
  let pre = "";
  let post = "";
  for (const event of arr(node.event)) {
    if (!isObj(event) || !isObj(event.script) || event.disabled === true) continue;
    const exec = event.script.exec;
    const code = (Array.isArray(exec) ? exec.map(str).join("\n") : str(exec)).trim();
    if (event.listen === "prerequest") pre = code;
    if (event.listen === "test") post = code;
  }
  return { pre, post };
}

function collectScripts(items: unknown[], into: string[]) {
  for (const item of items) {
    if (!isObj(item)) continue;
    const { pre, post } = scriptsOf(item);
    into.push(pre, post);
    if (Array.isArray(item.item)) collectScripts(item.item, into);
  }
}

export function importPostman(text: string): PostmanImport {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    throw new ImportError(`not valid JSON: ${(error as Error).message}`);
  }
  if (!isObj(doc) || !isObj(doc.info) || !Array.isArray(doc.item)) {
    throw new ImportError("not a Postman collection (expected info and item); export it from Postman as Collection v2.1");
  }
  const schema = str(doc.info.schema);
  if (schema && !/collection\/v2\.[01]/.test(schema)) throw new ImportError(`unsupported Postman schema ${schema}; export as Collection v2.1`);

  const notes = new Set<string>();
  const renamed = new Map<string, string>();
  const allScripts: string[] = [];
  const root = scriptsOf(doc);
  allScripts.push(root.pre, root.post);
  collectScripts(doc.item, allScripts);
  const locals = localVariableNames(allScripts);

  /** Postman `{{x}}` → Reqora `{{env.x}}` / `{{vars.x}}`; dynamic `{{$guid}}` stays. */
  const tpl = (value: unknown): string =>
    str(value).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (match, raw: string) => {
      if (raw.startsWith("$")) return `{{${raw}}}`;
      let name = raw;
      if (!VALID_NAME.test(name)) {
        name = safeName(raw);
        renamed.set(raw, name);
      }
      return `{{${locals.has(raw) ? "vars" : "env"}.${name}}}`;
    });

  const keyValues = (list: unknown): KeyValue[] =>
    arr(list)
      .filter(isObj)
      .map((h) => ({ key: str(h.key), value: tpl(h.value), enabled: h.disabled !== true }))
      .filter((h) => h.key);

  const auth = (value: unknown, where: string): Auth | undefined => {
    if (!isObj(value)) return undefined;
    const fields = (key: string) => {
      const list = arr(value[key]).filter(isObj);
      return (name: string) => tpl(list.find((f) => f.key === name)?.value);
    };
    switch (value.type) {
      case "noauth":
        return { type: "none" };
      case "bearer":
        return { type: "bearer", token: fields("bearer")("token") };
      case "basic":
        return { type: "basic", username: fields("basic")("username"), password: fields("basic")("password") };
      case "apikey": {
        const f = fields("apikey");
        if (f("in") === "query") notes.add(`${where}: API key sent as a query parameter was converted to a header — move it to Params if your API needs it in the URL.`);
        return { type: "apiKey", header: f("key") || "X-API-Key", value: f("value") };
      }
      default:
        notes.add(`${where}: "${str(value.type)}" auth isn't supported; it was left out (set the Authorization header yourself).`);
        return { type: "none" };
    }
  };

  const request = (item: Obj, where: string): ImportedRequest => {
    const req = isObj(item.request) ? item.request : { url: item.request };
    const def: RequestDefinition = emptyDefinition();
    const method = str(req.method || "GET").toUpperCase();
    if ((REQUEST_METHODS as readonly string[]).includes(method)) def.method = method as RequestMethod;
    else notes.add(`${where}: method ${method} isn't supported; it was imported as GET.`);

    // URL: raw without the query string; the query becomes params; :pathVariables take their values.
    const url = req.url;
    let raw = isObj(url) ? str(url.raw) : str(url);
    if (isObj(url)) {
      for (const v of arr(url.variable).filter(isObj)) {
        if (v.key && v.value !== undefined && str(v.value) !== "") raw = raw.replace(new RegExp(`:${str(v.key)}(?=/|$|\\?)`), str(v.value));
      }
    }
    const q = raw.indexOf("?");
    def.url = tpl(q >= 0 ? raw.slice(0, q) : raw).slice(0, 2000);
    def.params = isObj(url)
      ? keyValues(url.query)
      : q >= 0
        ? raw
            .slice(q + 1)
            .split("&")
            .filter(Boolean)
            .map((pair) => {
              const [k, ...rest] = pair.split("=");
              return { key: decodeURIComponent(k), value: tpl(rest.join("=")), enabled: true };
            })
        : [];
    def.headers = keyValues(req.header);
    const a = auth(req.auth, where);
    def.auth = a ?? { type: "inherit" };

    const body = isObj(req.body) ? req.body : undefined;
    if (body && body.disabled !== true) {
      const mode = str(body.mode);
      const hasType = (t: string) => def.headers.some((h) => h.key.toLowerCase() === "content-type" && h.value.includes(t));
      if (mode === "raw") {
        const language = isObj(body.options) && isObj(body.options.raw) ? str(body.options.raw.language) : "";
        const text = tpl(body.raw);
        def.body = language === "json" || hasType("json") || /^\s*[[{]/.test(text) ? { type: "json", text } : { type: "text", text };
      } else if (mode === "urlencoded" || mode === "formdata") {
        const fields = arr(body[mode]).filter(isObj).filter((f) => f.disabled !== true);
        if (fields.some((f) => f.type === "file")) notes.add(`${where}: file fields in form-data can't be sent; they were left out.`);
        const text = fields
          .filter((f) => f.type !== "file")
          .map((f) => `${encodeURIComponent(str(f.key))}=${tpl(f.value)}`)
          .join("&");
        def.body = { type: "text", text };
        if (!def.headers.some((h) => h.key.toLowerCase() === "content-type")) {
          def.headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
        }
        if (mode === "formdata") notes.add(`${where}: form-data body was converted to URL-encoded text.`);
      } else if (mode === "graphql" && isObj(body.graphql)) {
        const variables = str(body.graphql.variables).trim();
        let parsedVariables: unknown = {};
        try {
          parsedVariables = variables ? JSON.parse(variables) : {};
        } catch {
          notes.add(`${where}: GraphQL variables weren't valid JSON; they were left out.`);
        }
        def.body = { type: "json", text: JSON.stringify({ query: tpl(body.graphql.query), variables: parsedVariables }, null, 2) };
      } else if (mode && mode !== "none") {
        notes.add(`${where}: "${mode}" body isn't supported; it was left out.`);
      }
    }

    const { pre, post } = scriptsOf(item);
    def.preScript = pre;
    def.postScript = post;

    const examples = arr(item.response)
      .filter(isObj)
      .slice(0, 100)
      .map((r) => {
        const headers = Object.fromEntries(arr(r.header).filter(isObj).map((h) => [str(h.key).toLowerCase(), str(h.value)]));
        const bodyText = str(r.body);
        const response: ExampleResponse = {
          status: Math.min(599, Math.max(100, Number(r.code) || 200)),
          statusText: str(r.status),
          headers,
          body: bodyText,
          size: bodyText.length,
          durationMs: Number(r.responseTime) || 0,
        };
        return { name: (str(r.name) || "Example").slice(0, 120), response };
      });

    return { name: (str(item.name) || "Request").slice(0, 120), definition: def, ...(examples.length ? { examples } : {}) };
  };

  const settingsOf = (node: Obj, inherited: ScopeSettings | undefined, where: string): ScopeSettings => {
    const { pre, post } = scriptsOf(node);
    const join = (a: string | undefined, b: string) => [a, b].filter((s) => s && s.trim()).join("\n\n");
    return {
      ...emptyScopeSettings(),
      auth: auth(node.auth, where) ?? inherited?.auth ?? { type: "inherit" },
      headers: [],
      preScript: join(inherited?.preScript, pre),
      postScript: join(inherited?.postScript, post),
    };
  };

  const folders: ImportedCollection["folders"] = [];
  const requests: ImportedRequest[] = [];
  const walk = (items: unknown[], parent: { name: string; settings: ScopeSettings } | undefined) => {
    for (const item of items) {
      if (!isObj(item)) continue;
      const name = (str(item.name) || "Untitled").slice(0, 120);
      if (Array.isArray(item.item)) {
        const path = parent ? `${parent.name} / ${name}`.slice(0, 120) : name;
        if (parent) notes.add(`Nested folders were flattened (e.g. "${path}"), keeping their parent's auth and scripts.`);
        const settings = settingsOf(item, parent?.settings, `Folder "${path}"`);
        const folder = { name: path, settings, requests: [] as ImportedRequest[] };
        folders.push(folder);
        for (const child of item.item) {
          if (isObj(child) && !Array.isArray(child.item)) folder.requests.push(request(child, `"${str(child.name)}"`));
        }
        walk(item.item.filter((c) => isObj(c) && Array.isArray(c.item)), { name: path, settings });
      } else if (!parent) {
        requests.push(request(item, `"${name}"`));
      }
    }
  };
  walk(doc.item, undefined);

  const variables = arr(doc.variable)
    .filter(isObj)
    .filter((v) => v.disabled !== true && str(v.key))
    .map((v) => ({ name: VALID_NAME.test(str(v.key)) ? str(v.key) : safeName(str(v.key)), value: str(v.value), secret: v.type === "secret" }));

  if (renamed.size) {
    notes.add(`Variable names Reqora can't use were renamed: ${[...renamed].map(([a, b]) => `${a} → ${b}`).join(", ")}.`);
  }
  if (allScripts.some((s) => /pm\.sendRequest/.test(s))) notes.add("Scripts using pm.sendRequest won't work: Reqora scripts have no network access.");
  if (allScripts.some((s) => s.trim())) {
    notes.add("Scripts were kept as written; Reqora runs pm.* scripts through a Postman compatibility layer (pm.environment, pm.variables, pm.request, pm.response, pm.test, pm.expect).");
  }

  const description = isObj(doc.info.description) ? str(doc.info.description.content) : str(doc.info.description);
  return {
    name: (str(doc.info.name) || "Postman collection").slice(0, 120),
    ...(description ? { description: description.slice(0, 2000) } : {}),
    settings: settingsOf(doc, undefined, "Collection"),
    folders,
    requests,
    variables,
    notes: [...notes],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Export

/** Reqora `{{env.x}}` / `{{vars.x}}` → Postman `{{x}}`. */
const toPostmanTemplate = (value: string) => value.replace(/\{\{\s*(?:env|vars)\.([A-Za-z0-9_]+)\s*\}\}/g, "{{$1}}");

/** Common rq.* calls rewritten to Postman's pm.*; anything else is left as is. */
export function toPostmanScript(code: string): string {
  return code
    .replace(/\brq\.response\.status\b/g, "pm.response.code")
    .replace(/\brq\.(environment|variables|test|request|response)\b/g, "pm.$1")
    .replace(/\brq\.expect\(/g, "pm.expect(");
}

const assertionScript = (a: Assertion): string => {
  switch (a.type) {
    case "status":
      return `pm.test("Status is ${a.equals}", () => pm.response.to.have.status(${a.equals}));`;
    case "responseTimeBelow":
      return `pm.test("Response time below ${a.ms}ms", () => pm.expect(pm.response.responseTime).to.be.below(${a.ms}));`;
    case "headerContains":
      return `pm.test(${JSON.stringify(`${a.header} contains ${a.value}`)}, () => pm.expect(pm.response.headers.get(${JSON.stringify(a.header)}) || "").to.include(${JSON.stringify(a.value)}));`;
    case "bodyContains":
      return `pm.test(${JSON.stringify(`Body contains ${a.text}`)}, () => pm.expect(pm.response.text()).to.include(${JSON.stringify(a.text)}));`;
    case "jsonPathEquals":
      return `pm.test(${JSON.stringify(`${a.path} equals ${a.value}`)}, () => pm.expect(String(_.get(pm.response.json(), ${JSON.stringify(a.path)}))).to.eql(${JSON.stringify(a.value)}));`;
    case "jsonPathExists":
      return `pm.test(${JSON.stringify(`${a.path} exists`)}, () => pm.expect(_.get(pm.response.json(), ${JSON.stringify(a.path)})).to.not.be.undefined);`;
  }
};

const events = (pre: string, post: string) => {
  const out: Obj[] = [];
  const add = (listen: string, code: string) => {
    if (code.trim()) out.push({ listen, script: { type: "text/javascript", exec: toPostmanScript(code).split("\n") } });
  };
  add("prerequest", pre);
  add("test", post);
  return out.length ? { event: out } : {};
};

const postmanAuth = (auth: Auth): Obj | undefined => {
  const kv = (pairs: Record<string, string>) => Object.entries(pairs).map(([key, value]) => ({ key, value: toPostmanTemplate(value), type: "string" }));
  switch (auth.type) {
    case "inherit":
      return undefined;
    case "none":
      return { type: "noauth" };
    case "bearer":
      return { type: "bearer", bearer: kv({ token: auth.token }) };
    case "basic":
      return { type: "basic", basic: kv({ username: auth.username, password: auth.password }) };
    case "apiKey":
      return { type: "apikey", apikey: kv({ key: auth.header, value: auth.value, in: "header" }) };
  }
};

type ExportedRequest = CollectionExport["collection"]["requests"][number];

function postmanItem(r: ExportedRequest): Obj {
  const d = r.definition;
  const url = toPostmanTemplate(d.url);
  const query = d.params.map((p) => ({ key: p.key, value: toPostmanTemplate(p.value), ...(p.enabled ? {} : { disabled: true }) }));
  const enabledQuery = d.params.filter((p) => p.enabled && p.key);
  const raw = enabledQuery.length ? `${url}?${enabledQuery.map((p) => `${p.key}=${toPostmanTemplate(p.value)}`).join("&")}` : url;
  const auth = postmanAuth(d.auth);
  const post = [d.postScript, ...d.assertions.map(assertionScript)].filter((s) => s.trim()).join("\n");
  return {
    name: r.name,
    ...events(d.preScript, post),
    request: {
      method: d.method,
      header: d.headers.map((h) => ({ key: h.key, value: toPostmanTemplate(h.value), ...(h.enabled ? {} : { disabled: true }) })),
      ...(auth ? { auth } : {}),
      ...(d.body.type === "none"
        ? {}
        : {
            body: {
              mode: "raw",
              raw: toPostmanTemplate(d.body.text),
              ...(d.body.type === "json" ? { options: { raw: { language: "json" } } } : {}),
            },
          }),
      url: { raw, ...(query.length ? { query } : {}) },
    },
    response: r.examples.map((ex) => ({
      name: ex.name,
      code: ex.response.status,
      status: ex.response.statusText,
      header: Object.entries(ex.response.headers ?? {}).map(([key, value]) => ({ key, value: String(value) })),
      body: typeof ex.response.body === "string" ? ex.response.body : JSON.stringify(ex.response.body, null, 2),
    })),
  };
}

/** A Postman Collection v2.1 document from a Reqora export. */
export function exportPostman(exported: CollectionExport): Obj {
  const c = exported.collection;
  const auth = postmanAuth(c.settings.auth);
  const folderAuth = (s: ScopeSettings) => postmanAuth(s.auth);
  return {
    info: {
      name: c.name,
      ...(c.description ? { description: c.description } : {}),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    ...events(c.settings.preScript, c.settings.postScript),
    ...(auth ? { auth } : {}),
    item: [
      ...c.folders.map((f) => {
        const fa = folderAuth(f.settings);
        return { name: f.name, ...events(f.settings.preScript, f.settings.postScript), ...(fa ? { auth: fa } : {}), item: f.requests.map(postmanItem) };
      }),
      ...c.requests.map(postmanItem),
    ],
  };
}
