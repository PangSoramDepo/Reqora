import { describe, expect, it } from "vitest";
import { exportPostman, importPostman, toPostmanScript } from "./postman";
import { emptyDefinition, emptyScopeSettings, type CollectionExport } from "./schema";
import { runScripts } from "./scripts";

const collection = {
  info: { name: "IBB API", description: "Bank API", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  auth: { type: "bearer", bearer: [{ key: "token", value: "{{accessToken}}", type: "string" }] },
  event: [{ listen: "prerequest", script: { exec: ['pm.variables.set("requestId", "r-1");'] } }],
  variable: [
    { key: "baseUrl", value: "https://api.ibb.test" },
    { key: "api-key", value: "k1", type: "secret" },
  ],
  item: [
    {
      name: "Auth",
      item: [
        {
          name: "Login",
          event: [
            {
              listen: "test",
              script: {
                exec: [
                  'pm.test("ok", () => pm.response.to.have.status(200));',
                  'pm.collectionVariables.set("accessToken", pm.response.json().token);',
                ],
              },
            },
          ],
          request: {
            method: "POST",
            auth: { type: "noauth" },
            header: [{ key: "X-Api-Key", value: "{{api-key}}" }, { key: "X-Old", value: "1", disabled: true }],
            body: { mode: "raw", raw: '{ "user": "{{user}}", "rid": "{{requestId}}" }', options: { raw: { language: "json" } } },
            url: {
              raw: "{{baseUrl}}/v2/login?lang=en&debug=1",
              host: ["{{baseUrl}}"],
              query: [{ key: "lang", value: "en" }, { key: "debug", value: "1", disabled: true }],
            },
          },
          response: [{ name: "OK", code: 200, status: "OK", header: [{ key: "Content-Type", value: "application/json" }], body: '{"token":"t"}' }],
        },
        {
          name: "Admin",
          auth: { type: "basic", basic: [{ key: "username", value: "admin" }, { key: "password", value: "{{adminPass}}" }] },
          item: [
            {
              name: "Users",
              request: { method: "GET", url: "{{baseUrl}}/users/:id?x=1", header: [] },
            },
          ],
        },
      ],
    },
    {
      name: "Upload",
      request: {
        method: "POST",
        url: { raw: "{{baseUrl}}/files/:fileId", variable: [{ key: "fileId", value: "f9" }] },
        body: { mode: "formdata", formdata: [{ key: "name", value: "a b" }, { key: "file", type: "file", src: "/x" }] },
      },
    },
    { name: "Weird", request: { method: "PROPFIND", url: "https://x.test", auth: { type: "oauth2" } } },
  ],
};

describe("importPostman", () => {
  const imported = importPostman(JSON.stringify(collection));

  it("maps collection, folders (flattened) and requests", () => {
    expect(imported.name).toBe("IBB API");
    expect(imported.description).toBe("Bank API");
    expect(imported.settings).toMatchObject({ auth: { type: "bearer", token: "{{env.accessToken}}" }, preScript: 'pm.variables.set("requestId", "r-1");' });
    expect(imported.folders.map((f) => [f.name, f.requests.map((r) => r.name)])).toEqual([
      ["Auth", ["Login"]],
      ["Auth / Admin", ["Users"]],
    ]);
    expect(imported.folders[1].settings?.auth).toEqual({ type: "basic", username: "admin", password: "{{env.adminPass}}" });
    expect(imported.requests.map((r) => r.name)).toEqual(["Upload", "Weird"]);
  });

  it("converts URL, params, headers, auth, body, scripts and examples", () => {
    const login = imported.folders[0].requests[0];
    const d = login.definition;
    expect(d.method).toBe("POST");
    expect(d.url).toBe("{{env.baseUrl}}/v2/login");
    expect(d.params).toEqual([
      { key: "lang", value: "en", enabled: true },
      { key: "debug", value: "1", enabled: false },
    ]);
    // Invalid variable names are renamed; names the scripts set with pm.variables become {{vars.x}}.
    expect(d.headers).toEqual([
      { key: "X-Api-Key", value: "{{env.api_key}}", enabled: true },
      { key: "X-Old", value: "1", enabled: false },
    ]);
    expect(d.auth).toEqual({ type: "none" });
    expect(d.body).toEqual({ type: "json", text: '{ "user": "{{env.user}}", "rid": "{{vars.requestId}}" }' });
    expect(d.postScript).toContain("pm.collectionVariables.set");
    expect(login.examples).toEqual([
      { name: "OK", response: { status: 200, statusText: "OK", headers: { "content-type": "application/json" }, body: '{"token":"t"}', size: 13, durationMs: 0 } },
    ]);

    const users = imported.folders[1].requests[0].definition;
    expect([users.url, users.params, users.auth]).toEqual(["{{env.baseUrl}}/users/:id", [{ key: "x", value: "1", enabled: true }], { type: "inherit" }]);

    const upload = imported.requests[0].definition;
    expect(upload.url).toBe("{{env.baseUrl}}/files/f9");
    expect(upload.body).toEqual({ type: "text", text: "name=a b" });
    expect(upload.headers).toContainEqual({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
  });

  it("returns collection variables and explains what it changed", () => {
    expect(imported.variables).toEqual([
      { name: "baseUrl", value: "https://api.ibb.test", secret: false },
      { name: "api_key", value: "k1", secret: true },
    ]);
    const notes = imported.notes.join("\n");
    expect(notes).toMatch(/Nested folders were flattened/);
    expect(notes).toMatch(/file fields in form-data/);
    expect(notes).toMatch(/method PROPFIND isn't supported/);
    expect(notes).toMatch(/"oauth2" auth isn't supported/);
    expect(notes).toMatch(/api-key → api_key/);
  });

  it("imported pm.* scripts run in Reqora", async () => {
    const login = imported.folders[0].requests[0].definition;
    const { state, errors } = await runScripts({
      phase: "post",
      readEnv: () => undefined,
      state: { request: { method: "POST", url: "x", params: [], headers: {} }, variables: {}, logs: [], tests: [], environment: {} },
      response: { status: 200, statusText: "OK", headers: {}, body: '{"token":"tok-1"}', responseTime: 5 },
      scripts: [{ scope: "request", name: "Login", code: login.postScript }],
    });
    expect(errors).toEqual([]);
    expect(state.tests).toMatchObject([{ name: "ok", passed: true }]);
    expect(state.environment).toEqual({ accessToken: "tok-1" });
  });

  it("rejects things that aren't Postman collections", () => {
    expect(() => importPostman("nope")).toThrow(/not valid JSON/);
    expect(() => importPostman('{"a":1}')).toThrow(/not a Postman collection/);
    expect(() => importPostman('{"info":{"schema":"https://schema.getpostman.com/json/collection/v1.0.0/"},"item":[]}')).toThrow(/unsupported/);
  });
});

describe("exportPostman", () => {
  const def = {
    ...emptyDefinition(),
    method: "POST" as const,
    url: "{{env.baseUrl}}/orders",
    params: [
      { key: "page", value: "{{vars.page}}", enabled: true },
      { key: "off", value: "1", enabled: false },
    ],
    headers: [{ key: "X-Trace", value: "{{env.trace}}", enabled: true }],
    auth: { type: "bearer" as const, token: "{{env.token}}" },
    body: { type: "json" as const, text: '{"a":1}' },
    preScript: 'rq.variables.set("page", "2");',
    postScript: 'rq.environment.set("id", rq.response.json().id);',
    assertions: [{ type: "status" as const, equals: 201 }],
  };
  const exported: CollectionExport = {
    reqora: "collection",
    version: 1,
    collection: {
      name: "Orders",
      settings: { ...emptyScopeSettings(), auth: { type: "apiKey", header: "X-Key", value: "{{env.key}}" } },
      folders: [{ name: "V1", settings: emptyScopeSettings(), requests: [{ name: "Create", definition: def, examples: [] }] }],
      requests: [],
    },
  };

  it("produces a v2.1 collection with Postman templates, auth, body, scripts and tests", () => {
    const pm = exportPostman(exported) as {
      info: { schema: string };
      auth: unknown;
      item: { name: string; item: { request: Record<string, unknown>; event: { listen: string; script: { exec: string[] } }[] }[] }[];
    };
    expect(pm.info.schema).toMatch(/v2\.1\.0/);
    expect(pm.auth).toEqual({
      type: "apikey",
      apikey: [
        { key: "key", value: "X-Key", type: "string" },
        { key: "value", value: "{{key}}", type: "string" },
        { key: "in", value: "header", type: "string" },
      ],
    });
    const item = pm.item[0].item[0];
    expect(item.request).toMatchObject({
      method: "POST",
      header: [{ key: "X-Trace", value: "{{trace}}" }],
      auth: { type: "bearer", bearer: [{ key: "token", value: "{{token}}", type: "string" }] },
      body: { mode: "raw", raw: '{"a":1}', options: { raw: { language: "json" } } },
      url: { raw: "{{baseUrl}}/orders?page={{page}}", query: [{ key: "page", value: "{{page}}" }, { key: "off", value: "1", disabled: true }] },
    });
    expect(item.event.map((e) => [e.listen, e.script.exec.join("\n")])).toEqual([
      ["prerequest", 'pm.variables.set("page", "2");'],
      ["test", 'pm.environment.set("id", pm.response.json().id);\npm.test("Status is 201", () => pm.response.to.have.status(201));'],
    ]);
  });

  it("round-trips through importPostman", () => {
    const back = importPostman(JSON.stringify(exportPostman(exported)));
    const d = back.folders[0].requests[0].definition;
    expect([d.method, d.url, d.auth]).toEqual(["POST", "{{env.baseUrl}}/orders", { type: "bearer", token: "{{env.token}}" }]);
    // "page" is set by a pm.variables script, so it comes back as {{vars.page}}.
    expect(d.params[0]).toEqual({ key: "page", value: "{{vars.page}}", enabled: true });
  });

  it("rewrites common rq calls to pm", () => {
    expect(toPostmanScript("rq.test('x', () => rq.expect(rq.response.status).toBe(200)); rq.environment.get('a');")).toBe(
      "pm.test('x', () => pm.expect(pm.response.code).toBe(200)); pm.environment.get('a');",
    );
  });
});
