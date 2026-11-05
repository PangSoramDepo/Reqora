import { describe, expect, it } from "vitest";
import { runScripts, type ScriptResponse, type ScriptState } from "./scripts";

const state = (): ScriptState => ({
  request: { method: "GET", url: "https://api.test/orders", params: [{ key: "page", value: "1" }], headers: { Accept: "application/json" } },
  variables: {},
  logs: [],
  tests: [],
  environment: {},
});
const env = (name: string) => ({ baseUrl: "https://api.test", token: "tok-abcdef" })[name];
const response: ScriptResponse = {
  status: 201,
  statusText: "Created",
  headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "r1" },
  body: JSON.stringify({ id: "o1", items: [1, 2], user: { name: "Ann", roles: ["admin"] }, token: "new-token-123" }),
  responseTime: 42,
};

const post = (code: string) => runScripts({ phase: "post", readEnv: env, state: state(), response, scripts: [{ scope: "request", name: "R", code }] });
const pre = (code: string) => runScripts({ phase: "pre", readEnv: env, state: state(), scripts: [{ scope: "request", name: "R", code }] });

describe("pm compatibility", () => {
  it("runs a typical Postman test script unchanged", async () => {
    const { state: out, errors } = await post(`
pm.test("Status code is 201", function () { pm.response.to.have.status(201); });
pm.test("created", () => pm.expect(pm.response.code).to.equal(201));
pm.test("is success", () => pm.response.to.be.success);
pm.test("has JSON body", () => { pm.response.to.be.json; pm.response.to.have.jsonBody("user.name", "Ann"); });
pm.test("content type", () => pm.response.to.have.header("Content-Type"));
const json = pm.response.json();
pm.test("body", () => {
  pm.expect(json.items).to.be.an("array").that.has.lengthOf(2);
  pm.expect(json.items).to.include(2);
  pm.expect(json).to.have.property("user").that.has.property("name", "Ann");
  pm.expect(json.user).to.deep.include({ name: "Ann" });
  pm.expect(json.id).to.be.a("string").and.not.be.empty;
  pm.expect(json.missing).to.be.undefined;
  pm.expect(pm.response.responseTime).to.be.below(500);
  pm.expect(json.user.roles).to.eql(["admin"]);
  pm.expect("abc").to.match(/b/);
  pm.expect(3).to.be.oneOf([1, 2, 3]);
});
pm.environment.set("token", json.token);
pm.collectionVariables.set("orderId", json.id);
tests["legacy check"] = responseCode.code === 201;
`);
    expect(errors).toEqual([]);
    expect(out.tests.map((t) => [t.name, t.passed, t.error ?? null])).toEqual([
      ["Status code is 201", true, null],
      ["created", true, null],
      ["is success", true, null],
      ["has JSON body", true, null],
      ["content type", true, null],
      ["body", true, null],
      ["legacy check", true, null],
    ]);
    expect(out.environment).toEqual({ token: "new-token-123", orderId: "o1" });
  });

  it("reports failing chai assertions with readable messages", async () => {
    const { state: out } = await post(`
pm.test("status", () => pm.response.to.have.status(200));
pm.test("equal", () => pm.expect(1).to.equal(2));
pm.test("not", () => pm.expect("a").to.not.equal("a"));
pm.test("ok", () => pm.response.to.be.ok);
`);
    expect(out.tests.map((t) => [t.passed, t.error])).toEqual([
      [false, "expected response to have status 200 (got 201)"],
      [false, "expected 1 to equal 2"],
      [false, 'expected "a" not to equal "a"'],
      [false, "expected response to be ok (got 201)"],
    ]);
  });

  it("pre-request: variables, environment, request edits, replaceIn, btoa", async () => {
    const { state: out, errors } = await pre(`
const base = pm.environment.get("baseUrl");
pm.variables.set("ts", "123");
pm.request.headers.add({ key: "Authorization", value: "Basic " + btoa("user:pass") });
pm.request.headers.upsert({ key: "accept", value: "text/plain" });
pm.request.url.query.add({ key: "q", value: "x" });
pm.request.method = "post";
pm.request.body = { mode: "raw", raw: JSON.stringify({ at: pm.variables.get("ts") }) };
console.log(pm.variables.replaceIn("{{baseUrl}}/v1?t={{token}}"), pm.request.url.getHost(), pm.info.eventName, atob("aGk="));
postman.setEnvironmentVariable("legacy", "1");
`);
    expect(errors).toEqual([]);
    expect(out.request).toMatchObject({
      method: "POST",
      headers: { Authorization: "Basic dXNlcjpwYXNz", accept: "text/plain" },
      params: [{ key: "page", value: "1" }, { key: "q", value: "x" }],
      body: '{"at":"123"}',
    });
    expect(out.variables).toEqual({ ts: "123" });
    expect(out.environment).toEqual({ legacy: "1" });
    expect(out.logs[0].message).toBe("https://api.test/v1?t=tok-abcdef api.test prerequest hi");
  });

  it("explains what isn't available", async () => {
    const send = await pre(`pm.sendRequest("https://x", () => {});`);
    expect(send.errors[0].message).toMatch(/pm.sendRequest isn't available/);
    const list = await pre(`pm.environment.toObject();`);
    expect(list.errors[0].message).toMatch(/listing environment values isn't allowed/);
  });
});

describe("form bodies in scripts", () => {
  it("reads and edits urlencoded / form-data fields, keeping files the request already has", async () => {
    const start: ScriptState = {
      ...state(),
      request: {
        ...state().request,
        method: "POST",
        formMode: "formdata",
        form: [
          { key: "name", value: "Ann" },
          { key: "doc", value: "", type: "file", src: "a.pdf" },
        ],
      },
    };
    const { state: out, errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: start,
      scripts: [
        {
          scope: "request",
          name: "R",
          code: `
const body = pm.request.body;
console.log(body.mode, body.formdata.get("name"), body.formdata.count(), JSON.stringify(body.formdata.toObject()));
body.formdata.upsert({ key: "name", value: "Bob" });
body.formdata.add({ key: "ts", value: "1" });
rq.request.form.push({ key: "evil", type: "file", src: "/etc/passwd" });`,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.logs.map((l) => l.message)).toEqual(['formdata Ann 2 {"name":"Ann"}']);
    expect(out.request.form).toEqual([
      { key: "name", value: "Bob" },
      { key: "doc", value: "", type: "file", src: "a.pdf" },
      { key: "ts", value: "1" },
    ]);
    expect(out.request.formMode).toBe("formdata");
  });
});
