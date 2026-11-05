import { beforeAll, describe, expect, it, vi } from "vitest";
import { executeWorkflow, type EngineDeps, type ProgressEvent } from "@/lib/workflows/engine";
import type { WorkflowInput, WorkflowNode } from "@/lib/workflows/schema";
import type { RequestDefinition } from "./schema";

process.env.REQORA_DB_PATH = ":memory:";

let store: typeof import("./store");
let linked: typeof import("./linked");

beforeAll(async () => {
  store = await import("./store");
  linked = await import("./linked");
});

function savedRequest(name: string, patch: Partial<RequestDefinition>) {
  const col = store.createCollection({ name: `${name} API` });
  store.updateCollection(col.id, { settings: { ...col.settings, headers: [{ key: "X-Tenant", value: "acme", enabled: true }] } });
  const created = store.createRequest(col.id, { name, folderId: null });
  if (!created.ok) throw new Error(created.reason);
  const save = (next: Partial<RequestDefinition>) => {
    const result = store.replaceRequest(created.request.id, {
      name,
      folderId: null,
      definition: { ...created.request.definition, ...patch, ...next },
    });
    if (!result.ok) throw new Error(result.reason);
  };
  save({});
  return { id: created.request.id, save };
}

const httpNode = (id: string, requestId: string): WorkflowNode => ({
  id,
  name: id,
  type: "http",
  position: { x: 0, y: 0 },
  // A stale copy, as dropped onto the canvas earlier.
  config: { method: "POST", url: "https://api.test/stale", headers: {}, timeoutMs: 10_000, requestId },
});

function chain(...requestIds: string[]): WorkflowInput {
  const ids = requestIds.map((_, i) => `n${i + 1}`);
  return {
    name: "linked",
    nodes: [
      { id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/x" } },
      ...requestIds.map((rid, i) => httpNode(ids[i], rid)),
    ],
    edges: ids.map((id, i) => ({ id: `e${i}`, source: i === 0 ? "in" : ids[i - 1], sourcePort: "out", target: id })),
  };
}

function capture(reply: (url: string) => Response = () => Response.json({ token: "tok-123" })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return reply(String(input));
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

/** The runner's wiring, with a fake network. */
function deps(fetch: typeof globalThis.fetch, extra: Partial<EngineDeps> = {}): EngineDeps {
  const variables: Record<string, string> = {};
  return {
    fetch,
    env: () => undefined,
    baseUrl: "http://reqora.test",
    sendLinked: (requestId, context) =>
      linked.sendLinkedRequest(requestId, { environment: "sandbox", baseUrl: "http://reqora.test", variables, context, fetch }),
    ...extra,
  };
}

const header = (init: RequestInit, name: string) => new Headers(init.headers).get(name);

describe("linked http nodes", () => {
  it("send the saved request as it is now, with collection headers and its scripts", async () => {
    const login = savedRequest("Login", { method: "POST", url: "https://api.test/v1/login" });
    login.save({
      method: "PUT",
      url: "https://api.test/v2/login",
      headers: [{ key: "X-Sig", value: "{{vars.sig}}", enabled: true }],
      body: { type: "json", text: '{ "user": "{{trigger.body.user}}" }' },
      preScript: 'rq.variables.set("sig", "signed-" + "abc");',
      postScript: 'rq.test("has token", () => rq.expect(rq.response.json().token).toBe("tok-123")); console.log("logged in");',
    });

    const { calls, fetch } = capture();
    const result = await executeWorkflow(chain(login.id), { source: "manual", body: { user: "ann" } }, deps(fetch));

    expect(result.status).toBe("succeeded");
    expect(calls[0].url).toBe("https://api.test/v2/login");
    expect(calls[0].init.method).toBe("PUT");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ user: "ann" });
    expect(header(calls[0].init, "x-tenant")).toBe("acme");
    expect(header(calls[0].init, "x-sig")).toBe("signed-abc");
    expect(result.steps[1].output).toMatchObject({ status: 200, tests: [{ name: "has token", passed: true }], logs: ["logged in"] });
  });

  it("share rq.variables between linked requests in one run", async () => {
    const login = savedRequest("Login2", {
      url: "https://api.test/login",
      postScript: 'rq.variables.set("token", rq.response.json().token);',
    });
    const me = savedRequest("Me", {
      method: "GET",
      url: "https://api.test/me",
      headers: [{ key: "Authorization", value: "Bearer {{vars.token}}", enabled: true }],
    });
    const { calls, fetch } = capture();
    const result = await executeWorkflow(chain(login.id, me.id), { source: "manual" }, deps(fetch));
    expect(result.status).toBe("succeeded");
    expect(header(calls[1].init, "authorization")).toBe("Bearer tok-123");
    expect(result.steps[2].request?.headers.Authorization).toBe("Bearer tok-123");
  });

  it("fail the step on a failed test or a script error, and skip what follows", async () => {
    const check = savedRequest("Check", {
      url: "https://api.test/check",
      postScript: 'rq.test("is admin", () => rq.expect(rq.response.json().admin).toBe(true));',
    });
    const next = savedRequest("Next", { url: "https://api.test/next" });
    const { calls, fetch } = capture();
    const result = await executeWorkflow(chain(check.id, next.id), { source: "manual" }, deps(fetch));
    expect(result.steps[1]).toMatchObject({ status: "failed", error: "1 test failed: is admin" });
    expect(result.steps[2].status).toBe("skipped");
    expect(calls).toHaveLength(1);

    const broken = savedRequest("Broken", { url: "https://api.test/x", preScript: "throw new Error('nope')" });
    const second = await executeWorkflow(chain(broken.id), { source: "manual" }, deps(capture().fetch));
    expect(second.steps[1].error).toMatch(/pre-request script \(request “Broken”\) failed: .*nope/);
  });

  it("fail clearly when the linked request was deleted", async () => {
    const gone = savedRequest("Gone", { url: "https://api.test/gone" });
    store.deleteRequest(gone.id);
    const { calls, fetch } = capture();
    const result = await executeWorkflow(chain(gone.id), { source: "manual" }, deps(fetch));
    expect(calls).toHaveLength(0);
    expect(result.steps[1].error).toMatch(/linked Collections request was deleted/);
  });

  it("send the stored copy when no linked sender is given", async () => {
    const login = savedRequest("Copy", { url: "https://api.test/v2/login" });
    const { calls, fetch } = capture();
    await executeWorkflow(chain(login.id), { source: "manual" }, { fetch, env: () => undefined, baseUrl: "http://reqora.test" });
    expect(calls[0].url).toBe("https://api.test/stale");
  });

  it("report progress: each node starts, then its step finishes", async () => {
    const a = savedRequest("A", { url: "https://api.test/a" });
    const events: ProgressEvent[] = [];
    await executeWorkflow(chain(a.id), { source: "manual" }, deps(capture().fetch, { onProgress: (e) => events.push(e) }));
    expect(events.map((e) => (e.type === "node" ? `start ${e.nodeId}` : e.type === "step" ? `${e.step.status} ${e.step.nodeId}` : `attempt ${e.nodeId}`))).toEqual([
      "start in",
      "succeeded in",
      "start n1",
      "succeeded n1",
    ]);
  });

  it("syncLinkedNodes refreshes the copy and keeps the link; unknown requests keep their last copy", () => {
    const login = savedRequest("Sync", { method: "PATCH", url: "https://api.test/v3/login" });
    const synced = linked.syncLinkedNodes(chain(login.id));
    const node = synced.nodes[1] as Extract<WorkflowNode, { type: "http" }>;
    expect(node.config).toMatchObject({ method: "PATCH", url: "https://api.test/v3/login", requestId: login.id });

    // Flow-only settings survive the refresh.
    const withRepeat = chain(login.id);
    const repeat = { mode: "compare" as const, left: "{{n1.body.status}}", operator: "==" as const, right: "DONE", intervalMs: 1000, maxAttempts: 5 };
    (withRepeat.nodes[1] as Extract<WorkflowNode, { type: "http" }>).config.repeat = repeat;
    expect((linked.syncLinkedNodes(withRepeat).nodes[1] as Extract<WorkflowNode, { type: "http" }>).config.repeat).toEqual(repeat);

    const gone = linked.syncLinkedNodes(chain("req_missing"));
    expect(gone.nodes[1]).toEqual(chain("req_missing").nodes[1]);
  });
});
