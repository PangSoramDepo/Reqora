import { describe, expect, it } from "vitest";
import { checkConditionScript, wrapCondition } from "./condition-script";

// The shape of a batch-list response: uploads, each with a file hash and a numeric status.
const batchList = (status: number) => ({
  status: 200,
  headers: { "content-type": "application/json" },
  body: {
    status: 0,
    data: [
      { file_hash: "other-hash", file_name: "a.xlsx", status: 2 },
      { file_hash: "hash-123456", file_name: "payroll.xlsx", status },
    ],
  },
});
const readEnv = (name: string) => (name === "file_hash" ? "hash-123456" : undefined);
const SCRIPT = `const item = response.body.data.find((i) => i.file_hash === rq.environment.get("file_hash"));
return item !== undefined && item.status === 2;`;

describe("checkConditionScript", () => {
  it("finds the item by an environment value and checks its status", async () => {
    expect(await checkConditionScript(SCRIPT, batchList(1), { readEnv })).toEqual({ met: false });
    expect(await checkConditionScript(SCRIPT, batchList(2), { readEnv })).toEqual({ met: true });
    // Missing item: not met (not an error).
    expect(await checkConditionScript(SCRIPT, batchList(2), { readEnv: () => "nope" })).toEqual({ met: false });
  });

  it("accepts a plain expression, pm, lodash and rq.variables", async () => {
    expect(await checkConditionScript('response.body.data.some(i => i.file_hash == rq.environment.get("file_hash") && i.status == 2);', batchList(2), { readEnv })).toEqual({ met: true });
    expect(await checkConditionScript('_.find(pm.response.json().data, { file_hash: rq.variables.get("hash") }).status === 2', batchList(2), { readEnv, variables: { hash: "hash-123456" } })).toEqual({ met: true });
  });

  it("reports mistakes instead of retrying forever", async () => {
    expect(await checkConditionScript("response.body.missing.status === 2", batchList(2), { readEnv })).toMatchObject({ error: expect.stringMatching(/failed: TypeError: .*undefined \(line 1: /) });
    expect(await checkConditionScript("return (", batchList(2), { readEnv })).toMatchObject({ error: expect.stringMatching(/script failed/) });
    expect(await checkConditionScript("  ", batchList(2), { readEnv })).toEqual({ error: '"repeat until" script is empty' });
  });

  it("only wraps expressions; code with return is a function body", () => {
    expect(wrapCondition("a === 1;")).toContain("return (a === 1\n);");
    expect(wrapCondition("if (x) return true;\nreturn false")).toContain("if (x) return true;\nreturn false");
  });
});

describe("condition script logs", () => {
  it("returns console output with the result, including when the script throws", async () => {
    const logged = await checkConditionScript('console.log("status:", response.body.data[1].status); return false;', batchList(1), { readEnv });
    expect(logged).toEqual({ met: false, logs: ["status: 1"] });
    const thrown = await checkConditionScript('console.log("before"); return response.body.nope.x;', batchList(1), { readEnv });
    expect(thrown).toMatchObject({ logs: ["before"], error: expect.stringContaining("failed: TypeError") });
  });
});
