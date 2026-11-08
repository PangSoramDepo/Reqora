import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowInput, WorkflowNode } from "./schema";

process.env.REQORA_DB_PATH = ":memory:";

let store: typeof import("./store");
let runner: typeof import("./runner");

beforeAll(async () => {
  store = await import("./store");
  runner = await import("./runner");
});

const trigger: WorkflowNode = { id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/x" } };
const at = { x: 0, y: 0 };

/** trigger → nodes in a chain. */
function flow(name: string, ...nodes: WorkflowNode[]): WorkflowInput {
  const all = [trigger, ...nodes];
  return { name, nodes: all, edges: nodes.map((n, i) => ({ id: `e${i}`, source: all[i].id, sourcePort: "out", target: n.id })) };
}

const call = (workflowId: string, body?: string): WorkflowNode => ({
  id: "call-1",
  name: "Call",
  type: "call",
  position: at,
  config: { workflowId, ...(body === undefined ? {} : { body }) },
});
const respond = (body: string): WorkflowNode => ({ id: "out", name: "Respond", type: "response", position: at, config: { status: 201, body } });
const options = { baseUrl: "http://reqora.test", environment: "sandbox" as const };

describe("Call Flow node", () => {
  it("runs the called flow's live version with the body template and passes its Response on", async () => {
    const child = store.createWorkflow("ws_default", flow("Greeter", respond('{ "greeting": "hi {{trigger.body.who}}" }')));
    store.deployWorkflow(child.id, 1);
    // A draft edit after deploying must not affect callers.
    store.replaceWorkflow(child.id, flow("Greeter", respond('{ "greeting": "DRAFT" }')), 1);

    const parent = store.createWorkflow("ws_default", 
      flow("Parent", call(child.id, '{ "who": "{{trigger.body.name}}" }'), respond('{ "said": "{{call-1.body.greeting}}" }')),
    );
    const { run } = await runner.runWorkflow(parent, { source: "manual", body: { name: "ann" } }, options);

    expect(run.status).toBe("succeeded");
    expect(run.output).toEqual({ status: 201, body: { said: "hi ann" } });
    const step = run.steps.find((s) => s.nodeId === "call-1")!;
    expect(step.output).toMatchObject({ workflowId: child.id, workflowName: "Greeter", version: 1, live: true, status: 201 });

    // The called run is stored on its own, pointing back at the caller.
    const childRun = store.getRun((step.output as { runId: string }).runId)!;
    expect(childRun).toMatchObject({
      workflowId: child.id,
      trigger: { source: "flow", body: { who: "ann" } },
      calledBy: { runId: run.id, workflowId: parent.id, nodeId: "call-1" },
    });
  });

  it("runs the draft of a flow that was never deployed, and sends the caller's trigger body without a template", async () => {
    const child = store.createWorkflow("ws_default", flow("Echo", respond('{ "got": {{trigger.body}} }')));
    const parent = store.createWorkflow("ws_default", flow("Parent2", call(child.id)));
    const { run } = await runner.runWorkflow(parent, { source: "manual", body: { a: 1 } }, options);
    expect(run.status).toBe("succeeded");
    expect(run.steps[1].output).toMatchObject({ live: false, body: { got: { a: 1 } } });
  });

  it("fails the step when the called flow fails, is missing or not chosen", async () => {
    const broken = store.createWorkflow("ws_default", flow("Broken", respond('{ "x": "{{env.REQORA_TEST_MISSING}}" }')));
    const parent = store.createWorkflow("ws_default", flow("Parent3", call(broken.id)));
    const { run } = await runner.runWorkflow(parent, { source: "manual" }, options);
    expect(run.status).toBe("failed");
    expect(run.steps[1].error).toMatch(/^flow “Broken” failed: Respond: /);

    const gone = await runner.runWorkflow(store.createWorkflow("ws_default", flow("Parent4", call("wf_missing"))), { source: "manual" }, options);
    expect(gone.run.steps[1].error).toBe("the called flow was deleted");

    const unset = await runner.runWorkflow(store.createWorkflow("ws_default", flow("Parent5", call(""))), { source: "manual" }, options);
    expect(unset.run.steps[1].error).toBe("pick the flow to call");
  });

  it("stops flows that call each other in a loop", async () => {
    const a = store.createWorkflow("ws_default", flow("Loop A", call("placeholder")));
    const b = store.createWorkflow("ws_default", flow("Loop B", call(a.id)));
    store.replaceWorkflow(a.id, flow("Loop A", call(b.id)), 1);
    const { run } = await runner.runWorkflow(store.getWorkflow(a.id)!, { source: "manual" }, options);
    expect(run.status).toBe("failed");
    expect(JSON.stringify(run.steps[1].error)).toContain("flows call each other in a loop: “Loop A” → “Loop B” → “Loop A”");
  });

  it("doesn't store called runs when the caller isn't stored (load tests)", async () => {
    const child = store.createWorkflow("ws_default", flow("Quiet", respond('{ "ok": true }')));
    const before = store.listRuns(child.id, 10).length;
    const result = await runner.executeScrubbed(store.createWorkflow("ws_default", flow("Load", call(child.id))), { source: "manual" }, options);
    expect(result.status).toBe("succeeded");
    expect(result.steps[1].output).not.toHaveProperty("runId");
    expect(store.listRuns(child.id, 10)).toHaveLength(before);
  });
});
