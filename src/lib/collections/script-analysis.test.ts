import { parser } from "@lezer/javascript";
import { describe, expect, it } from "vitest";
import { completeScript, hoverScript, lintScript } from "./script-analysis";

const lint = (code: string, phase: "pre" | "post" = "pre") => lintScript(code, parser.parse(code), phase);
const complete = (code: string, phase: "pre" | "post" = "pre", opts = {}) =>
  completeScript(code, parser.parse(code), code.length, phase, opts);
const labels = (code: string, phase: "pre" | "post" = "pre", opts = {}) => complete(code, phase, opts)?.options.map((o) => o.label);

describe("lintScript", () => {
  it("accepts valid scripts, including top-level return", () => {
    expect(lint('rq.environment.set("login_id", "123");\nif (!rq.variables.get("x")) return;')).toEqual([]);
    expect(lint('rq.test("ok", () => { rq.expect(rq.response.status).toBe(200).toBeTruthy(); });', "post")).toEqual([]);
    // Scripts run as an async function: top-level await and crypto.subtle are fine.
    expect(lint("const key = await crypto.subtle.importKey(\"raw\", new TextEncoder().encode(\"k\"), { name: \"HMAC\", hash: \"SHA-256\" }, false, [\"sign\"]);")).toEqual([]);
    expect(lint('const body = rq.response.json();\nconsole.log(body.items.length, rq.request.headers["X-A"]);', "post")).toEqual([]);
  });

  it("reports syntax errors with the engine's message at the broken spot", () => {
    const code = 'rq.variables.set("a", 1;\nconsole.log("ok");';
    const [d] = lint(code);
    expect(d.severity).toBe("error");
    expect(d.message).toMatch(/^Syntax error: /);
    expect(d.from).toBeGreaterThan(15);
    expect(d.from).toBeLessThanOrEqual(code.indexOf("\n"));
  });

  it("knows rq.user (test users): no warnings for saving a login token", () => {
    const script = ['rq.user.set("access_token", rq.response.json().access_token);', 'const id = rq.user.get("login_id");', "console.log(rq.user.name, rq.user.role, id);"].join("\n");
    expect(lint(script, "post")).toEqual([]);
    expect(lint("rq.user.sett('x', 1);", "post")[0].message).toBe('Property "sett" does not exist on rq.user. Did you mean "set"?');
  });

  it("flags unknown rq members with a suggestion", () => {
    const code = 'rq.enviroment.set("a", "1");';
    expect(lint(code)).toEqual([
      { from: 3, to: 13, severity: "error", message: 'Property "enviroment" does not exist on rq. Did you mean "environment"?' },
    ]);
    expect(lint('rq.expect(1).toBee(1);')[0].message).toBe('Property "toBee" does not exist on rq.expect(). Did you mean "toBe"?');
    expect(lint("console.debug(1);")[0].message).toContain("does not exist on console");
  });

  it("warns about rq.response in pre-request scripts", () => {
    expect(lint("console.log(rq.response.status);")[0]).toMatchObject({
      severity: "warning",
      message: expect.stringContaining("only available in post-response"),
    });
    expect(lint("console.log(rq.response.status);", "post")).toEqual([]);
  });

  it("checks environment names", () => {
    expect(lint('rq.environment.set("bad name", "1");')[0].message).toContain("not a valid environment variable name");
    expect(lint("const k = 'A'; rq.environment.get(k);")[0]).toMatchObject({ severity: "warning", message: expect.stringContaining("string literal") });
    expect(lint("rq.environment.get();")[0].message).toContain("needs a variable name");
    expect(lint("rq.environment.get(`TOKEN`);")).toEqual([]);
  });

  it("accepts require('crypto-js') and CryptoJS, and flags unknown modules", () => {
    expect(lint("const CryptoJS = require('crypto-js');\nCryptoJS.AES.decrypt('x', CryptoJS.enc.Utf8.parse('k'), { mode: CryptoJS.mode.ECB });")).toEqual([]);
    expect(lint("CryptoJS.SHA256('abc').toString();")).toEqual([]);
    expect(lint("const _ = require('lodash');")).toEqual([]);
    expect(lint("const a = require('axios');")).toEqual([
      { from: 18, to: 25, severity: "error", message: 'Cannot find module "axios". Scripts can require: crypto-js, lodash, moment.' },
    ]);
  });

  it("warns about globals the sandbox doesn't have, unless declared", () => {
    expect(lint('fetch("https://x.dev");')[0].message).toContain("no network access");
    // Postman's pm API is supported (compatibility layer), and its members are checked.
    expect(lint("pm.environment.set('A', 1); pm.expect(1).to.be.ok; pm.request.headers.add({ key: 'x', value: 'y' });")).toEqual([]);
    expect(lint("pm.enviroment.get('A');")[0].message).toContain('Did you mean "environment"');
    expect(lint("const fetch = () => 1; fetch();")).toEqual([]);
  });

  it("doesn't check objects it doesn't know or that the script shadows", () => {
    expect(lint("const rq2 = {}; rq2.anything; rq.response;", "post")).toEqual([]);
    expect(lint("const rq = { x: 1 }; rq.x;")).toEqual([]);
  });
});

describe("completeScript", () => {
  it("completes rq members after a dot, and narrows by what's typed", () => {
    expect(labels("rq.")).toEqual(["request", "response", "variables", "environment", "user", "test", "expect"]);
    expect(labels("rq.user.")).toEqual(["name", "roles", "role", "get", "set", "unset", "has"]);
    const partial = complete("rq.env");
    expect(partial?.from).toBe(3);
    expect(partial?.options.map((o) => o.label)).toContain("environment");
    expect(labels("rq.environment.")).toEqual(["get", "set", "unset", "has", "replaceIn"]);
    expect(labels("rq.response.", "post")).toContain("json");
  });

  it("completes matchers after rq.expect(...)", () => {
    expect(labels("rq.expect(rq.response.json().items).")).toContain("toHaveProperty");
    expect(labels("rq.expect(1).toBe(1).")).toContain("toEqual");
  });

  it("marks rq.response as unavailable in pre-request scripts", () => {
    const response = complete("rq.")?.options.find((o) => o.label === "response");
    expect(response?.boost).toBe(-1);
    expect(response?.info).toContain("Not available in pre-request");
  });

  it("offers environment names inside rq.environment.get(\"…\")", () => {
    const r = complete('rq.environment.get("', "pre", { envNames: ["API_KEY", "TOKEN"] });
    expect(r).toEqual({
      from: 20,
      options: [
        { label: "API_KEY", type: "variable", detail: "environment variable" },
        { label: "TOKEN", type: "variable", detail: "environment variable" },
      ],
    });
    expect(complete('console.log("', "pre", { envNames: ["A"] })).toBeNull();
  });

  it("offers module names inside require(\"…\")", () => {
    expect(labels('const CryptoJS = require("')).toEqual(["crypto-js", "lodash", "moment"]);
  });

  it("offers the API roots for a bare word, not for a declaration", () => {
    expect(labels("r")).toEqual(expect.arrayContaining(["rq", "console", "require", "pm", "CryptoJS", "_", "moment"]));
    expect(labels("const r")).toBeUndefined();
  });

  it("leaves unknown objects to the editor's own completions", () => {
    expect(complete("const a = {}; a.")).toBeNull();
    expect(complete("rq.response.json().", "post")).toBeNull();
  });
});

describe("hoverScript", () => {
  it("describes rq members", () => {
    const code = 'rq.environment.set("a", "1");';
    expect(hoverScript(code, parser.parse(code), 16)).toMatchObject({ title: "rq.environment.set", detail: "(name: string, value: any): void" });
    expect(hoverScript(code, parser.parse(code), 1)).toMatchObject({ title: "rq" });
    expect(hoverScript(code, parser.parse(code), 21)).toBeNull();
  });
});
