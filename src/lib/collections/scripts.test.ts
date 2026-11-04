import { describe, expect, it } from "vitest";
import { runScripts, type ScriptState } from "./scripts";

const state = (): ScriptState => ({
  request: { method: "GET", url: "https://x.dev/{{vars.path}}", params: [], headers: { Accept: "application/json" } },
  variables: {},
  logs: [],
  tests: [],
  environment: {},
});
const env = (name: string) => ({ API_KEY: "secret-key-123", OTHER_SECRET: "other-secret-456" })[name];
const okResponse = { status: 200, statusText: "OK", headers: {}, body: "", responseTime: 1 };

describe("script sandbox", () => {
  it("lets pre-request scripts edit the request and set variables, threading state through levels", async () => {
    const { state: out, errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [
        { scope: "collection", name: "API", code: `rq.variables.set("path", "orders"); rq.request.headers["X-Trace"] = "t-1";` },
        {
          scope: "request",
          name: "Get",
          code: `console.log("path is", rq.variables.get("path")); rq.request.method = "post"; rq.request.params.push({ key: "q", value: "1" });`,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.variables).toEqual({ path: "orders" });
    expect(out.request).toMatchObject({
      method: "POST",
      headers: { Accept: "application/json", "X-Trace": "t-1" },
      params: [{ key: "q", value: "1" }],
    });
    expect(out.logs).toEqual([{ level: "log", message: "path is orders", scope: "request", source: "Get" }]);
  });

  it("records rq.test results with rq.expect in post-response scripts", async () => {
    const { state: out, errors } = await runScripts({
      phase: "post",
      readEnv: env,
      state: state(),
      response: { status: 201, statusText: "Created", headers: {}, body: '{"id":"o1","items":[1,2]}', responseTime: 40 },
      scripts: [
        {
          scope: "request",
          name: "Create",
          code: `
            rq.test("created", () => rq.expect(rq.response.status).toBe(201));
            rq.test("has id", () => rq.expect(rq.response.json()).toHaveProperty("id"));
            rq.test("fast", () => rq.expect(rq.response.responseTime).toBeLessThan(10));
            rq.variables.set("orderId", rq.response.json().id);`,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.tests.map((t) => [t.name, t.passed])).toEqual([
      ["created", true],
      ["has id", true],
      ["fast", false],
    ]);
    expect(out.tests[2].error).toBe("expected 40 to be less than 10");
    expect(out.variables.orderId).toBe("o1");
  });

  it("is isolated from the server: no process, require, fetch or timers", async () => {
    const { state: out } = await runScripts({
      phase: "post",
      readEnv: env,
      state: state(),
      response: okResponse,
      scripts: [
        {
          scope: "request",
          name: "probe",
          code: `console.log([typeof process, typeof require, typeof fetch, typeof setTimeout, typeof XMLHttpRequest].join(","))`,
        },
      ],
    });
    expect(out.logs[0].message).toBe("undefined,undefined,undefined,undefined,undefined");
  });

  it("exposes only the environment names a script mentions literally", async () => {
    const { state: out } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [
        // OTHER_SECRET is only reachable by building its name at runtime, so it is never loaded into the sandbox.
        { scope: "request", name: "r", code: `const k = "OTHER" + "_SECRET"; console.log(rq.environment.get(k), rq.environment.get("API_KEY").length)` },
      ],
    });
    expect(out.logs[0].message).toBe("undefined 14");
  });

  it("stops runaway or failing pre-request scripts and reports where", async () => {
    const loop = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [
        { scope: "folder", name: "Orders", code: "while (true) {}" },
        { scope: "request", name: "never", code: `rq.variables.set("ran", "yes")` },
      ],
    });
    expect(loop.errors).toEqual([{ phase: "pre", scope: "folder", source: "Orders", message: "timed out after 1000ms" }]);
    expect(loop.state.variables.ran).toBeUndefined();

    const thrown = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [{ scope: "request", name: "r", code: `console.log("before"); null.x` }],
    });
    expect(thrown.errors[0].message).toMatch(/^TypeError: /);
    expect(thrown.state.logs.map((l) => l.message)).toEqual(["before"]);
  });

  it("sets and unsets environment values that later scripts can read, and rejects bad names", async () => {
    const { state: out, errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [
        { scope: "collection", name: "API", code: `rq.environment.set("login_id", 123); rq.environment.unset("API_KEY");` },
        { scope: "request", name: "Get", code: `console.log(rq.environment.get("login_id"), rq.environment.get("API_KEY"), rq.environment.has("login_id"));` },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.environment).toEqual({ login_id: "123", API_KEY: null });
    expect(out.logs.map((l) => l.message)).toEqual(["123 undefined true"]);

    const bad = await runScripts({ phase: "pre", readEnv: env, state: state(), scripts: [{ scope: "request", name: "Get", code: `rq.environment.set("bad name", "x");` }] });
    expect(bad.errors[0].message).toMatch(/invalid name "bad name"/);
    expect(bad.state.environment).toEqual({});
  });

  it("caps memory", async () => {
    const { errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [{ scope: "request", name: "r", code: "const a = []; while (true) a.push(new Array(100000).fill(1));" }],
    });
    expect(errors[0].message).toMatch(/out of memory|timed out/);
  });
});
