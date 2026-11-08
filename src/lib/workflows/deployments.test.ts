import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowInput } from "./schema";

process.env.REQORA_DB_PATH = ":memory:";

let store: typeof import("./store");
beforeAll(async () => {
  store = await import("./store");
});

const input = (path: string): WorkflowInput => ({
  name: "deploy test",
  nodes: [{ id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path } }],
  edges: [],
});
const pathOf = (w: { nodes: WorkflowInput["nodes"] }) => (w.nodes[0].config as { path: string }).path;
const me = { id: "usr_1", name: "Pang" };

describe("deployment history", () => {
  it("seeded workflows start with one live deployment", () => {
    const seeded = store.listWorkflows("ws_default")[0];
    const history = store.listDeployments(seeded.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ version: 1, live: true });
  });

  it("records each deploy (with who), newest first, and only the newest is live", () => {
    const wf = store.createWorkflow("ws_default", input("/v1"));
    expect(store.listDeployments(wf.id)).toEqual([]);
    expect(store.deployWorkflow(wf.id, 1, me).ok).toBe(true);
    const v2 = store.replaceWorkflow(wf.id, input("/v2"), 1);
    if (!v2.ok) throw new Error();
    expect(store.deployWorkflow(wf.id, 2).ok).toBe(true);

    const history = store.listDeployments(wf.id);
    expect(history.map((d) => [d.version, d.live, d.deployedBy?.name ?? null])).toEqual([
      [2, true, null],
      [1, false, "Pang"],
    ]);
    expect(history[0]).toMatchObject({ nodeCount: 1, edgeCount: 0 });
    expect(pathOf(store.getDeployment(wf.id, history[1].id)!)).toBe("/v1");
    // A stale deploy attempt adds nothing.
    expect(store.deployWorkflow(wf.id, 1).ok).toBe(false);
    expect(store.listDeployments(wf.id)).toHaveLength(2);
  });

  it("rolls back: the old definition goes live, the draft is kept, and the rollback is recorded", () => {
    const wf = store.createWorkflow("ws_default", input("/a"));
    store.deployWorkflow(wf.id, 1);
    store.replaceWorkflow(wf.id, input("/b"), 1);
    store.deployWorkflow(wf.id, 2);
    store.replaceWorkflow(wf.id, input("/draft"), 2);
    const [, first] = store.listDeployments(wf.id);

    const result = store.rollbackDeployment(wf.id, first.id, me);
    if (!result.ok) throw new Error(result.reason);
    expect(result.workflow.deployment?.version).toBe(1);
    expect(pathOf(store.getDeployedWorkflow(wf.id)!)).toBe("/a");
    expect(pathOf(store.getWorkflow(wf.id)!)).toBe("/draft");

    const history = store.listDeployments(wf.id);
    expect(history.map((d) => [d.version, d.live, d.rollbackOf?.version ?? null])).toEqual([
      [1, true, 1],
      [2, false, null],
      [1, false, null],
    ]);
    expect(history[0].deployedBy).toEqual(me);
    expect(store.rollbackDeployment(wf.id, history[0].id)).toEqual({ ok: false, reason: "already_live" });
    expect(store.rollbackDeployment(wf.id, "dep_missing")).toEqual({ ok: false, reason: "not_found" });
  });

  it("history is deleted with the workflow", () => {
    const wf = store.createWorkflow("ws_default", input("/x"));
    store.deployWorkflow(wf.id, 1);
    store.deleteWorkflow(wf.id);
    expect(store.listDeployments(wf.id)).toEqual([]);
  });
});
