import { createCipheriv, generateKeyPairSync, verify } from "node:crypto";
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

    const missing = await runScripts({ phase: "pre", readEnv: env, state: state(), scripts: [{ scope: "request", name: "R", code: `require("axios");` }] });
    expect(missing.errors[0].message).toBe('Error: Cannot find module "axios". Scripts can require: crypto-js, lodash, moment (line 1: require("axios");)');
  });

  it("provides lodash (require or the _ global) and moment, like Postman", async () => {
    const { state: out, errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [
        {
          scope: "request",
          name: "R",
          code: `const lodash = require("lodash");
const moment = require("moment");
rq.variables.set("picked", JSON.stringify(lodash.pick({ a: 1, b: 2, c: 3 }, ["a", "c"])));
rq.variables.set("grouped", Object.keys(_.groupBy([1.2, 1.8, 2.1], Math.floor)).join(","));
rq.variables.set("date", moment.utc("2026-01-31T10:00:00Z").add(1, "month").format("YYYY-MM-DD"));
rq.variables.set("same", String(lodash === _));`,
        },
      ],
    });
    expect(errors).toEqual([]);
    expect(out.variables).toEqual({ picked: '{"a":1,"c":3}', grouped: "1,2", date: "2026-02-28", same: "true" });
  });

  it("loads a library only when the script uses it", async () => {
    const { errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      // "my_var.x" and "moments" must not load lodash or moment; without them these globals are undefined.
      scripts: [{ scope: "request", name: "R", code: `const my_var = { x: 1 }; const moments = 2; my_var.x; if (typeof _ !== "undefined" || typeof moment !== "undefined") throw new Error("loaded");` }],
    });
    expect(errors).toEqual([]);
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

  it("gives rq.request.url (a string) the Postman URL helpers", async () => {
    const { state: out, errors } = await runScripts({
      phase: "post",
      readEnv: env,
      state: { ...state(), request: { method: "GET", url: "{{baseUrl}}/api/v1/batches", params: [{ key: "page", value: "2" }], headers: {} } },
      response: okResponse,
      scripts: [{ scope: "collection", name: "c", code: `const u = rq.request.url;
console.log(u.getPath(), u.getHost(), u.getQueryString(), u.getPathWithQuery());
console.log("https://bank.test/a/b?x=1".getPath(), "https://bank.test/a/b?x=1".getQueryString(), pm.request.url.getPath());
console.log(typeof u, u.includes("v1"));` }],
    });
    expect(errors).toEqual([]);
    expect(out.logs.map((l) => l.message)).toEqual([
      "/api/v1/batches {{baseUrl}} page=2 /api/v1/batches?page=2",
      "/a/b x=1 /api/v1/batches",
      "string true",
    ]);
  });

  it("logs caught errors with their name, message and line, and says where an uncaught error was thrown", async () => {
    const { state: out, errors } = await runScripts({
      phase: "post",
      readEnv: env,
      state: state(),
      response: okResponse,
      scripts: [{ scope: "collection", name: "c", code: `try {
  const data = undefined;
  data.items.map((i) => i);
} catch (error) {
  console.log("Collection Post Script Error: ", error);
  console.log({ failed: error });
  throw error;
}` }],
    });
    expect(out.logs.map((l) => l.message)).toEqual([
      "Collection Post Script Error:  TypeError: cannot read property 'items' of undefined\n    at line 3:7",
      `{"failed":{"name":"TypeError","message":"cannot read property 'items' of undefined"}}`,
    ]);
    expect(errors[0].message).toBe("TypeError: cannot read property 'items' of undefined (line 3: data.items.map((i) => i);)");
  });

  it("says where a syntax error is, with a hint for await in a regular callback", async () => {
    const { errors } = await runScripts({
      phase: "pre",
      readEnv: env,
      state: state(),
      scripts: [{ scope: "collection", name: "c", code: "let a = [1];\na.forEach((x) => {\n  rq.request.body = await sign(x);\n});" }],
    });
    expect(errors[0].message).toMatch(/^SyntaxError: .* \(line 3: rq\.request\.body = await sign\(x\);\) — await works at the top level/);
  });
});

describe("async scripts and Web APIs", () => {
  const run = (code: string, readEnv: (name: string) => string | undefined = env, request = state().request) =>
    runScripts({ phase: "pre", readEnv, state: { ...state(), request }, scripts: [{ scope: "collection", name: "c", code }] });

  it("supports top-level await, async functions and rejected promises", async () => {
    const ok = await run(`async function twice(x) { return x * 2; }
const v = await twice(await Promise.resolve(21));
rq.request.body = String(v);`);
    expect(ok.errors).toEqual([]);
    expect(ok.state.request.body).toBe("42");

    const rejected = await run('console.log("start");\nawait Promise.reject(new TypeError("bad key"));');
    expect(rejected.errors[0].message).toBe('TypeError: bad key (line 2: await Promise.reject(new TypeError("bad key"));)');
    expect(rejected.state.logs.map((l) => l.message)).toEqual(["start"]);

    const stuck = await run("await new Promise(() => {});");
    expect(stuck.errors[0].message).toMatch(/never settles/);
  });

  it("has UTF-8 TextEncoder / TextDecoder and crypto.randomUUID", async () => {
    const { state: out, errors } = await run(`const bytes = new TextEncoder().encode("ážé €😀");
console.log(Array.from(bytes).join(","));
console.log(new TextDecoder().decode(bytes));
console.log(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(crypto.randomUUID()));`);
    expect(errors).toEqual([]);
    expect(out.logs.map((l) => l.message)).toEqual([
      [...Buffer.from("ážé €😀", "utf8")].join(","),
      "ážé €😀",
      "true",
    ]);
  });

  it("signs an RS256 JWT with crypto.subtle (the Postman pattern), verifiable by the public key", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    const readEnv = (name: string) => (name === "client_private_key" ? pem : undefined);
    const { state: out, errors } = await run(
      `rq.request.body = await sign(JSON.stringify({ payload: JSON.parse(rq.request.body) }));

async function sign(bodyStr) {
    bodyStr = JSON.stringify(JSON.parse(bodyStr).payload);
    const privateKeyPem = rq.environment.get('client_private_key');
    const cryptoKey = await crypto.subtle.importKey('pkcs8', pemToArrayBuffer(privateKeyPem),
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const encodedHeader = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const encodedPayload = base64UrlEncode(bodyStr);
    const signingInput = \`\${encodedHeader}.\${encodedPayload}\`;
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
    return \`\${signingInput}.\${base64UrlEncode(signature)}\`;
}

function base64UrlEncode(input) {
    let bytes;
    if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
    else if (typeof input === 'string') bytes = new TextEncoder().encode(input);
    else throw new TypeError('Input must be a string or ArrayBuffer');
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
}

function pemToArrayBuffer(pem) {
    const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\\s/g, '');
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}`,
      readEnv,
      { ...state().request, method: "POST", body: '{"amount":10,"name":"Sokha"}' },
    );
    expect(errors).toEqual([]);
    const [header, payload, signature] = String(out.request.body).split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({ amount: 10, name: "Sokha" });
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("digests, HMACs, verifies and AES-GCM round-trips; reports bad input clearly", async () => {
    const { state: out, errors } = await run(`const enc = (s) => new TextEncoder().encode(s);
const hex = (buf) => Array.from(new Uint8Array(buf), (b) => (b + 256).toString(16).slice(1)).join("");
console.log(hex(await crypto.subtle.digest("SHA-256", enc("abc"))));
const hmacKey = await crypto.subtle.importKey("raw", enc("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const mac = await crypto.subtle.sign("HMAC", hmacKey, enc("msg"));
console.log(hex(mac), await crypto.subtle.verify("HMAC", hmacKey, mac, enc("msg")), await crypto.subtle.verify("HMAC", hmacKey, mac, enc("other")));
const aesKey = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(7), "AES-GCM", false, ["encrypt", "decrypt"]);
const iv = new Uint8Array(12).fill(1);
const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, enc("hello"));
console.log(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, sealed)));
try { await crypto.subtle.sign("HMAC", aesKey, enc("x")); } catch (e) { console.log(e.name, e.message); }
try { await crypto.subtle.importKey("pkcs8", enc("not a key"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); } catch (e) { console.log("bad key:", e.name); }`);
    expect(errors).toEqual([]);
    const { createHash, createHmac } = await import("node:crypto");
    expect(out.logs.map((l) => l.message)).toEqual([
      createHash("sha256").update("abc").digest("hex"),
      `${createHmac("sha256", "secret").update("msg").digest("hex")} true false`,
      "hello",
      'InvalidAccessError the key was not imported for "sign"',
      "bad key: Error",
    ]);
  });

  it("replaceIn resolves {{env.NAME}} / {{NAME}} templates used in the request body", async () => {
    const readEnv = (name: string) => ({ file_hash: "h-123", amount: "10" })[name];
    const { state: out, errors } = await run(
      'rq.request.body = rq.environment.replaceIn(rq.request.body);\nconsole.log(pm.environment.replaceIn("{{amount}}"));',
      readEnv,
      { ...state().request, method: "POST", body: '{"hash":"{{env.file_hash}}","n":"{{amount}}","x":"{{unknown}}"}' },
    );
    expect(errors).toEqual([]);
    expect(out.request.body).toBe('{"hash":"h-123","n":"10","x":"{{unknown}}"}');
    expect(out.logs.map((l) => l.message)).toEqual(["10"]);
  });
});
