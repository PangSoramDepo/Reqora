import { describe, expect, it } from "vitest";
import { runNodeScript } from "./node-script";

const context = {
  trigger: { body: { fileHash: "hash-123456" }, headers: {} },
  nodes: { "http-2": { status: 200, body: { data: [{ file_hash: "hash-123456", status: 2, batch_id: "B-7" }] } } },
};
const readEnv = (name: string) => (name === "prefix" ? "PAY" : undefined);

describe("runNodeScript", () => {
  it("reads the trigger, earlier nodes and the environment; the returned object is the output", async () => {
    const variables: Record<string, string> = { carried: "yes" };
    const result = await runNodeScript(
      `const item = nodes["http-2"].body.data.find((i) => i.file_hash === trigger.body.fileHash);
console.log("found", item.batch_id);
rq.variables.set("batchId", item.batch_id);
rq.environment.set("last_batch", rq.environment.get("prefix") + "-" + item.batch_id);
return { batchId: item.batch_id, carried: rq.variables.get("carried") };`,
      context,
      { readEnv, variables },
    );
    expect(result).toEqual({
      output: { batchId: "B-7", carried: "yes" },
      logs: ["found B-7"],
      environment: { last_batch: "PAY-B-7" },
    });
    // The shared bag is updated in place, without the sandbox's internal keys.
    expect(variables).toEqual({ carried: "yes", batchId: "B-7" });
  });

  it("wraps non-object return values, and returns null for no return", async () => {
    const opts = { readEnv, variables: {} };
    expect((await runNodeScript("return [1, 2];", context, opts))).toMatchObject({ output: { value: [1, 2] } });
    expect((await runNodeScript('return "done";', context, opts))).toMatchObject({ output: { value: "done" } });
    expect((await runNodeScript("const x = 1;", context, opts))).toMatchObject({ output: { value: null } });
    expect((await runNodeScript('return _.sumBy([{ n: 1 }, { n: 2 }], "n");', context, opts))).toMatchObject({ output: { value: 3 } });
  });

  it("fails on a throw or a failed test, keeping the logs", async () => {
    const opts = { readEnv, variables: {} };
    const thrown = await runNodeScript('console.log("before"); throw new Error("no batch");', context, opts);
    expect(thrown).toMatchObject({ error: expect.stringContaining("no batch"), logs: ["before"] });
    const failed = await runNodeScript('rq.test("has data", () => rq.expect(nodes["http-2"].body.data.length).toBe(0)); return {};', context, opts);
    expect(failed).toMatchObject({ error: expect.stringContaining('test "has data" failed') });
    expect(await runNodeScript("return () => 1;", context, opts)).toMatchObject({ error: expect.stringContaining("isn't JSON") });
  });
});
