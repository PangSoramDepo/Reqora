import { describe, expect, it } from "vitest";
import { instrumentScript, type ScriptDebug } from "./script-debug";
import { runScripts, type ScriptResponse, type ScriptState } from "./scripts";

const state = (): ScriptState => ({ request: { method: "GET", url: "https://x.test", params: [], headers: {} }, variables: {}, logs: [], tests: [], environment: {} });
const response: ScriptResponse = { status: 200, statusText: "OK", headers: {}, body: '{"access_token":"tok-1","items":[1,2,3]}', responseTime: 5 };
const debugRun = async (code: string, phase: "pre" | "post" = "post") => {
  const ran = await runScripts({ phase, readEnv: () => undefined, state: state(), response: phase === "post" ? response : undefined, scripts: [{ scope: "request", name: "R", code }], debug: true });
  return { ...ran, trace: ran.debug![0] };
};
/** The value of `name` at step i, decoded. */
const valueAt = (t: ScriptDebug, i: number, name: string) => (t.steps[i].vars[name] === undefined ? undefined : t.values[t.steps[i].vars[name]]);

describe("instrumentScript", () => {
  it("adds a probe before each statement in a block, keeping line numbers", () => {
    const code = "const a = 1;\nif (a) b();\nfor (const x of [1]) {\n  console.log(x);\n}";
    const out = instrumentScript(code)!;
    expect(out.code.split("\n")).toHaveLength(5);
    // The unbraced `if` body isn't probed (that would change what the if guards).
    expect(out.points.map((p) => p.line)).toEqual([1, 2, 3, 4, 5]);
    expect(out.points[3].names).toEqual(["a", "x"]);
    expect(out.points[0].names).toEqual(["a"]);
    expect(out.code).toContain("if (a) b();");
  });

  it("scopes names to their block, function or catch clause", () => {
    const code = "function f(p) {\n  let q = p;\n  return q;\n}\ntry { f(1); } catch (e) {\n  console.log(e);\n}";
    const points = instrumentScript(code, ["trigger"])!.points;
    const at = (line: number) => points.find((p) => p.line === line)!.names;
    expect(at(2)).toEqual(["trigger", "f", "p", "q"]);
    expect(at(6)).toEqual(["trigger", "f", "e"]);
    expect(at(5)).toEqual(["trigger", "f"]);
  });

  it("marks debugger; statements and gives up on code that doesn't parse", () => {
    expect(instrumentScript("x();\ndebugger;")!.points[1]).toMatchObject({ line: 2, pause: true });
    expect(instrumentScript("const = ;")).toBeNull();
  });
});

describe("debug runs", () => {
  it("record each step with the variables and rq changes at that point", async () => {
    const { trace, state: out } = await debugRun(
      ['const body = rq.response.json();', 'let n = 0;', 'for (const i of body.items) {', '  n += i;', '}', 'rq.environment.set("total", String(n));', 'console.log("total", n);'].join("\n"),
    );
    expect(out.environment).toEqual({ total: "6" });
    expect(trace.steps.map((s) => s.line)).toEqual([1, 2, 3, 4, 4, 4, 6, 7, 7, 7]);
    expect(valueAt(trace, 1, "body")).toEqual({ t: "object", entries: [["access_token", "tok-1"], ["items", { t: "array", length: 3, items: [1, 2, 3] }]] });
    expect(valueAt(trace, 1, "n")).toBeUndefined(); // not declared yet
    expect(valueAt(trace, 5, "n")).toBe(3);
    expect(valueAt(trace, 8, "n")).toBe(6);
    expect(trace.states[trace.steps[6].state].environment).toEqual({});
    expect(trace.states[trace.steps[7].state].environment).toEqual({ total: "6" });
    expect(trace.steps.at(-1)).toMatchObject({ end: true });
    expect(trace.logs).toEqual([{ step: 7, level: "log", message: "total 6" }]);
    expect(out.logs).toEqual([{ level: "log", message: "total 6", scope: "request", source: "R" }]);
  });

  it("stops at the line that threw, and still reports the error's line", async () => {
    const { trace, errors } = await debugRun("const a = { b: null };\nconst c = 1;\na.b.c();\nconsole.log('never');");
    expect(errors[0].message).toMatch(/line 3: a\.b\.c\(\);/);
    expect(trace.error).toEqual({ step: 2, message: errors[0].message });
    expect(trace.steps[2].line).toBe(3);
  });

  it("records functions, loops cut off at the step limit, and special values", async () => {
    const { trace } = await debugRun("const f = (x) => {\n  return x * 2;\n};\nlet m = new Map([[1, 'a']]);\nlet u;\nlet d = new Date(0);\nfor (let i = 0; i < 5000; i++) {\n  f(i);\n}", "pre");
    expect(trace.truncated).toBe(true);
    expect(trace.steps.length).toBeLessThanOrEqual(2001);
    const at = trace.steps.findIndex((s) => s.line === 2);
    expect(valueAt(trace, at, "x")).toBe(0);
    expect(valueAt(trace, at, "m")).toEqual({ t: "object", cls: "Map", entries: [["1", "a"]] });
    expect(valueAt(trace, at, "u")).toEqual({ t: "undefined" });
    expect(valueAt(trace, at, "d")).toEqual({ t: "date", v: "1970-01-01T00:00:00.000Z" });
    expect(valueAt(trace, at, "f")).toEqual({ t: "function", name: "f" });
  });

  it("explains a syntax error instead of recording", async () => {
    const { trace, errors } = await debugRun("const = ;");
    expect(errors).toHaveLength(1);
    expect(trace.note).toMatch(/syntax error/);
    expect(trace.steps).toEqual([]);
  });

  it("doesn't change normal runs", async () => {
    const ran = await runScripts({ phase: "post", readEnv: () => undefined, state: state(), response, scripts: [{ scope: "request", name: "R", code: "console.log(1);" }] });
    expect(ran.debug).toBeUndefined();
    expect(ran.state.logs).toEqual([{ level: "log", message: "1", scope: "request", source: "R" }]);
  });
});

describe("debug runs of flow scripts", () => {
  it("record a Script node with trigger and nodes, on the node's own lines", async () => {
    const { runNodeScript } = await import("./node-script");
    const result = await runNodeScript(
      "const id = trigger.body.id;\nconst found = nodes.list.items.find((i) => i === id);\nreturn { found };",
      { trigger: { body: { id: 2 } }, nodes: { list: { items: [1, 2] } } },
      { readEnv: () => undefined, variables: {}, debug: true },
    );
    expect(result).toMatchObject({ output: { found: 2 } });
    const trace = result.debug![0];
    expect(trace.code).toBe("const id = trigger.body.id;\nconst found = nodes.list.items.find((i) => i === id);\nreturn { found };");
    expect(trace.steps.map((s) => s.line)).toEqual([1, 2, 3, 3]);
    expect(valueAt(trace, 1, "id")).toBe(2);
    expect(valueAt(trace, 0, "trigger")).toEqual({ t: "object", entries: [["body", { t: "object", entries: [["id", 2]] }]] });
  });

  it("record a repeat-until condition as written, with `response`", async () => {
    const { checkConditionScript } = await import("./condition-script");
    const checked = await checkConditionScript("response.body.done === true", { status: 200, body: { done: false } }, { readEnv: () => undefined, debug: true });
    expect(checked).toMatchObject({ met: false });
    const trace = checked.debug![0];
    expect(trace.code).toBe("response.body.done === true");
    expect(trace.steps[0].line).toBe(1);
    expect(valueAt(trace, 0, "response")).toMatchObject({ t: "object" });
  });
});

describe("debug run state", () => {
  it("records the edited request in pre-request scripts only", async () => {
    const pre = await debugRun('rq.request.headers["X-A"] = "1";\nconsole.log(1);', "pre");
    expect(pre.trace.states[pre.trace.steps[1].state].request).toMatchObject({ headers: { "X-A": "1" } });
    const post = await debugRun("console.log(1);");
    expect(post.trace.states[0].request).toBeUndefined();
  });
});
