import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCRIPT_MODULE_NAMES } from "./script-api";
import { runScripts, SCRIPT_MODULES, type ScriptState } from "./scripts";

const state = (): ScriptState => ({
  request: { method: "GET", url: "https://x.dev/{{vars.path}}", params: [], headers: { Accept: "application/json" } },
  variables: {},
  logs: [],
  tests: [],
  environment: {},
});
const env = (name: string) => ({ API_KEY: "secret-key-123", OTHER_SECRET: "other-secret-456" })[name];
const okResponse = { status: 200, statusText: "OK", headers: {}, body: "", responseTime: 1 };

describe("script modules", () => {
  it("supports require('crypto-js') like Postman: AES-ECB decrypt of a response field", async () => {
    const key = "0123456789abcdef0123456789abcdef"; // 32 UTF-8 bytes → AES-256
    const cipher = createCipheriv("aes-256-ecb", Buffer.from(key, "utf8"), null);
    const qr = Buffer.concat([cipher.update(JSON.stringify({ verification_token: "vt-42" }), "utf8"), cipher.final()]).toString("base64");

    const started = Date.now();
    const { state: out, errors } = await runScripts({
      phase: "post",
      readEnv: env,
      state: state(),
      response: { ...okResponse, body: JSON.stringify({ data: { qr_content: qr } }) },
      scripts: [
        {
          scope: "request",
          name: "GenerateQr",
          code: `const CryptoJS = require('crypto-js');
const key = "${key}";
rq.test("decrypts", () => {
  const data = rq.response.json().data;
  const plain = aesDecryptECB(data.qr_content, key);
  rq.environment.set("verification_token", JSON.parse(plain).verification_token);
});
function aesDecryptECB(ciphertextBase64, key) {
  const keyHex = CryptoJS.enc.Utf8.parse(key);
  const decrypted = CryptoJS.AES.decrypt(ciphertextBase64, keyHex, { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 });
  return decrypted.toString(CryptoJS.enc.Utf8);
}`,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.tests).toMatchObject([{ name: "decrypts", passed: true }]);
    expect(out.environment).toEqual({ verification_token: "vt-42" });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("exposes CryptoJS as a global, has secure random for encryption, and names unknown modules", async () => {
    const { state: out, errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [
        {
          scope: "request",
          name: "R",
          code: `const enc = CryptoJS.AES.encrypt("hello", "passphrase").toString();
rq.variables.set("roundtrip", CryptoJS.AES.decrypt(enc, "passphrase").toString(CryptoJS.enc.Utf8));
rq.variables.set("sha", CryptoJS.SHA256("abc").toString());`,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.variables).toEqual({
      roundtrip: "hello",
      sha: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });

    const missing = await runScripts({ phase: "pre", readEnv: env, state: state(), scripts: [{ scope: "request", name: "R", code: `require("lodash");` }] });
    expect(missing.errors[0].message).toBe('Error: Cannot find module "lodash". Scripts can require: crypto-js');
  });

  it("matches the editor's list of modules", () => {
    expect(Object.keys(SCRIPT_MODULES)).toEqual([...SCRIPT_MODULE_NAMES]);
  });
});

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

  it("is isolated from the server: no process, Node modules, fetch or timers", async () => {
    const { state: out } = await runScripts({
      phase: "post",
      readEnv: env,
      state: state(),
      response: okResponse,
      scripts: [
        {
          scope: "request",
          name: "probe",
          code: `console.log([typeof process, typeof fetch, typeof setTimeout, typeof XMLHttpRequest].join(","));
for (const m of ["fs", "child_process", "crypto", "node:fs"]) { try { require(m); console.log("loaded " + m); } catch (e) { console.log("blocked " + m); } }`,
        },
      ],
    });
    expect(out.logs.map((l) => l.message)).toEqual([
      "undefined,undefined,undefined,undefined",
      "blocked fs",
      "blocked child_process",
      "blocked crypto",
      "blocked node:fs",
    ]);
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
