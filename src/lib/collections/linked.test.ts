import { beforeAll, describe, expect, it, vi } from "vitest";
import { executeWorkflow } from "@/lib/workflows/engine";
import type { WorkflowInput, WorkflowNode } from "@/lib/workflows/schema";
import type { RequestDefinition } from "./schema";

process.env.REQORA_DB_PATH = ":memory:";

let store: typeof import("./store");
let linked: typeof import("./linked");

beforeAll(async () => {
  store = await import("./store");
  linked = await import("./linked");
});

function savedLogin() {
  const col = store.createCollection({ name: "Auth API" });
  store.updateCollection(col.id, { settings: { ...col.settings, headers: [{ key: "X-Tenant", value: "acme", enabled: true }] } });
  const created = store.createRequest(col.id, { name: "Login", folderId: null });
  if (!created.ok) throw new Error(created.reason);
  const def = (patch: Partial<RequestDefinition>): RequestDefinition => ({ ...created.request.definition, ...patch });
  const save = (patch: Partial<RequestDefinition>) => {
    const result = store.replaceRequest(created.request.id, { name: "Login", folderId: null, definition: def(patch) });
    if (!result.ok) throw new Error(result.reason);
  };
  save({ method: "POST", url: "https://api.test/v1/login", body: { type: "json", text: '{ "user": "a" }' } });
  return { id: created.request.id, save };
}

function flowWith(requestId: string): WorkflowInput {
  const http: WorkflowNode = {
    id: "login",
    name: "Login",
    type: "http",
    position: { x: 0, y: 0 },
    // A stale copy, as dropped onto the canvas earlier.
    config: { method: "POST", url: "https://api.test/v1/login", headers: {}, body: '{ "user": "a" }', timeoutMs: 10_000, requestId },
  };
  return {
    name: "linked",
    nodes: [{ id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/x" } }, http],
    edges: [{ id: "a", source: "in", sourcePort: "out", target: "login" }],
  };
}

function capture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return Response.json({ token: "t" });
  });
  return { calls, fetch: fetch as unknown as typeof globalThis.fetch };
}

describe("linked http nodes", () => {
  it("runs the saved request as it is now, with collection headers", async () => {
    const login = savedLogin();
    login.save({ method: "PUT", url: "https://api.test/v2/login", body: { type: "json", text: '{ "user": "b" }' } });

    const { calls, fetch } = capture();
    const result = await executeWorkflow(flowWith(login.id), { source: "manual" }, {
      fetch,
      env: () => undefined,
      baseUrl: "http://reqora.test",
      linkedRequest: linked.linkedHttpConfig,
    });

    expect(result.status).toBe("succeeded");
    expect(calls[0].url).toBe("https://api.test/v2/login");
    expect(calls[0].init.method).toBe("PUT");
    expect(calls[0].init.body).toBe('{"user":"b"}');
    expect(new Headers(calls[0].init.headers).get("x-tenant")).toBe("acme");
  });

  it("runs the stored copy when links aren't followed (deployed snapshot)", async () => {
    const login = savedLogin();
    login.save({ url: "https://api.test/v2/login" });
    const { calls, fetch } = capture();
    await executeWorkflow(flowWith(login.id), { source: "manual" }, { fetch, env: () => undefined, baseUrl: "http://reqora.test" });
    expect(calls[0].url).toBe("https://api.test/v1/login");
  });

  it("fails the step clearly when the linked request was deleted", async () => {
    const login = savedLogin();
    store.deleteRequest(login.id);
    const { calls, fetch } = capture();
    const result = await executeWorkflow(flowWith(login.id), { source: "manual" }, {
      fetch,
      env: () => undefined,
      baseUrl: "http://reqora.test",
      linkedRequest: linked.linkedHttpConfig,
    });
    expect(calls).toHaveLength(0);
    expect(result.steps[1].error).toMatch(/linked Collections request was deleted/);
  });

  it("syncLinkedNodes refreshes the copy and keeps the link; unknown requests keep their last copy", () => {
    const login = savedLogin();
    login.save({ method: "PATCH", url: "https://api.test/v3/login" });
    const flow = flowWith(login.id);
    const synced = linked.syncLinkedNodes(flow);
    const node = synced.nodes[1] as Extract<WorkflowNode, { type: "http" }>;
    expect(node.config).toMatchObject({ method: "PATCH", url: "https://api.test/v3/login", requestId: login.id });

    const gone = linked.syncLinkedNodes(flowWith("req_missing"));
    expect(gone.nodes[1]).toEqual(flowWith("req_missing").nodes[1]);
  });
});
