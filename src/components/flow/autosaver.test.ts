import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workflow, WorkflowNode } from "@/lib/workflows/schema";

const saved: Workflow[] = [];
vi.mock("@/lib/workflows/client", () => ({
  ApiError: class extends Error {},
  fetchWorkflow: vi.fn(),
  saveWorkflow: vi.fn(async (w: Workflow) => {
    saved.push(w);
    return { ...w, version: w.version + 1 };
  }),
}));

const { createAutosaver } = await import("./autosaver");

const node = (id: string, x: number) => ({ id, type: "delay", name: id, position: { x, y: 0 }, config: { ms: 0 } }) as WorkflowNode;
const base = { id: "wf", name: "Flow", version: 1, nodes: [node("a", 0), node("b", 100)], edges: [] } as unknown as Workflow;

function setup() {
  let history = {};
  const saver = createAutosaver({ onChange: () => {}, onState: () => {}, onHistory: (h) => (history = h), debounceMs: 0 });
  saver.load(base);
  return { saver, history: () => history, xs: () => saver.current()!.nodes.map((n) => n.position.x) };
}

beforeEach(() => {
  saved.length = 0;
});

describe("autosaver undo / redo", () => {
  it("undoes and redoes a step, and saves the result", async () => {
    const { saver, history, xs } = setup();
    expect(history()).toEqual({});
    saver.update((wf) => ({ ...wf, nodes: wf.nodes.map((n) => ({ ...n, position: { x: 500, y: 0 } })) }), { label: "Auto align" });
    expect(history()).toEqual({ undo: "Auto align" });

    expect(saver.undo()).toBe("Auto align");
    expect(xs()).toEqual([0, 100]);
    expect(history()).toEqual({ redo: "Auto align" });
    await saver.flush();
    expect(saved.at(-1)!.nodes.map((n) => n.position.x)).toEqual([0, 100]);

    expect(saver.redo()).toBe("Auto align");
    expect(xs()).toEqual([500, 500]);
    expect(saver.redo()).toBeUndefined();
  });

  it("records a drag (local moves, then the drop) as one step", () => {
    const { saver, xs } = setup();
    for (const x of [10, 20, 30]) saver.update((wf) => ({ ...wf, nodes: [{ ...wf.nodes[0], position: { x, y: 0 } }, wf.nodes[1]] }), { save: false });
    saver.update((wf) => wf, { label: "Move node" });
    expect(saver.undo()).toBe("Move node");
    expect(xs()).toEqual([0, 100]);
  });

  it("groups typing in one node, but not separate actions", () => {
    const { saver } = setup();
    for (const name of ["N", "Ne", "New"]) saver.update((wf) => ({ ...wf, nodes: [{ ...wf.nodes[0], name }, wf.nodes[1]] }), { label: "Edit a", group: "node:a" });
    saver.update((wf) => ({ ...wf, name: "Renamed" }), { label: "Rename flow" });
    expect(saver.undo()).toBe("Rename flow");
    expect(saver.undo()).toBe("Edit a");
    expect(saver.current()!.nodes[0].name).toBe("a");
    expect(saver.undo()).toBeUndefined();
  });

  it("a new edit clears redo; untracked changes and no-op updates aren't steps", () => {
    const { saver, history } = setup();
    saver.update((wf) => ({ ...wf, name: "One" }), { label: "Rename flow" });
    saver.undo();
    saver.update((wf) => ({ ...wf, name: "Two" }), { label: "Rename flow" });
    expect(history()).toEqual({ undo: "Rename flow" });
    saver.update((wf) => ({ ...wf, name: "Refreshed" }), { track: false });
    saver.update((wf) => wf, { label: "Move node" });
    expect(saver.undo()).toBe("Rename flow");
    expect(saver.current()!.name).toBe("Flow");
  });

  it("loading another workflow starts a fresh history", () => {
    const { saver, history } = setup();
    saver.update((wf) => ({ ...wf, name: "X" }), { label: "Rename flow" });
    saver.load(base);
    expect(history()).toEqual({});
    expect(saver.undo()).toBeUndefined();
  });
});
