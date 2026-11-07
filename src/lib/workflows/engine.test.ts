import { describe, expect, it, vi } from "vitest";
import { executeWorkflow, type EngineDeps } from "./engine";
import { validateGraph } from "./graph";
import type { WorkflowInput } from "./schema";
import { SAMPLE_ORDER, SEED_WORKFLOWS } from "./seed";

const checkout = SEED_WORKFLOWS[0].input;

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init ?? {}));
}

function deps(overrides: Partial<EngineDeps> = {}): EngineDeps {
  return {
    fetch: fakeFetch((url) => {
      if (url.endsWith("/verify")) return Response.json({ customer_id: "cus_1" });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch,
    env: (name) => (name === "STRIPE_SECRET" ? "sk_test" : undefined),
    baseUrl: "http://reqora.test",
    sleep: async () => {},
    ...overrides,
  };
}

const statuses = (steps: { nodeId: string; status: string }[]) =>
  Object.fromEntries(steps.map((s) => [s.nodeId, s.status]));

describe("validateGraph", () => {
  it("accepts the seeded checkout workflow", () => {
    expect(validateGraph(checkout)).toEqual([]);
  });

  it("rejects unknown ports, missing nodes, extra triggers and cycles", () => {
    const base = checkout.nodes;
    expect(validateGraph({ nodes: base, edges: [{ id: "x", source: "node-2", sourcePort: "true", target: "node-3" }] }))
      .toEqual([{ path: "edges.0.sourcePort", message: '"http" node has no output port "true"' }]);
    expect(validateGraph({ nodes: base, edges: [{ id: "x", source: "node-1", sourcePort: "out", target: "ghost" }] }))
      .toEqual([{ path: "edges.0.target", message: 'unknown node "ghost"' }]);
    expect(validateGraph({ nodes: [...base, { ...base[0], id: "node-9" }], edges: [] })[0].message).toMatch(
      /exactly one webhook trigger/,
    );
    expect(
      validateGraph({
        nodes: base,
        edges: [
          { id: "a", source: "node-2", sourcePort: "out", target: "node-4" },
          { id: "b", source: "node-4", sourcePort: "out", target: "node-2" },
        ],
      }),
    ).toEqual([{ path: "edges", message: "graph contains a cycle" }]);
  });
});

describe("executeWorkflow", () => {
  it("runs the checkout flow and takes the VIP branch for large orders", async () => {
    const d = deps();
    const result = await executeWorkflow(checkout, { source: "manual", body: SAMPLE_ORDER }, d);

    expect(result.status).toBe("succeeded");
    expect(statuses(result.steps)).toEqual({
      "node-1": "succeeded",
      "node-2": "succeeded",
      "node-3": "succeeded",
      "node-4": "succeeded",
      "node-5": "succeeded",
    });
    expect(result.steps.find((s) => s.nodeId === "node-3")?.port).toBe("true");

    const calls = (d.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const [verifyUrl, verifyInit] = calls[0] as [string, RequestInit];
    expect(verifyUrl).toBe("http://reqora.test/api/demo/stripe/customers/verify");
    expect(new Headers(verifyInit.headers).get("authorization")).toBe("Bearer sk_test");
    expect(JSON.parse(verifyInit.body as string)).toEqual({ account_token: "ord_9941a", expected_amount: 749.5, risk_eval: true });

    const erpBody = JSON.parse((calls[1] as [string, RequestInit])[1].body as string);
    expect(erpBody).toEqual({ customer_id: "cus_1", sku: SAMPLE_ORDER.sku, qty: 1 });
  });

  it("skips the VIP branch for small orders", async () => {
    const result = await executeWorkflow(checkout, { source: "manual", body: { ...SAMPLE_ORDER, amount: 20 } }, deps());
    expect(result.status).toBe("succeeded");
    expect(statuses(result.steps)["node-5"]).toBe("skipped");
    expect(result.steps.find((s) => s.nodeId === "node-3")?.port).toBe("false");
  });

  it("records step requests as sent, with resolved values (run history shows real values)", async () => {
    const result = await executeWorkflow(checkout, { source: "manual", body: SAMPLE_ORDER }, deps());
    const verify = result.steps.find((s) => s.nodeId === "node-2")!;
    expect(verify.request?.headers.authorization).toBe("Bearer sk_test");
    // The body as sent, templates filled in.
    expect(JSON.parse(verify.request!.body!)).toEqual({ account_token: "ord_9941a", expected_amount: 749.5, risk_eval: true });
    // Also kept when the step fails.
    const failed = await executeWorkflow(checkout, { source: "manual", body: SAMPLE_ORDER }, deps({ fetch: fakeFetch(() => Response.json({}, { status: 500 })) as unknown as typeof fetch }));
    expect(failed.steps.find((s) => s.nodeId === "node-2")!.request?.body).toContain("ord_9941a");
  });

  it("fails the step on upstream errors and skips everything downstream", async () => {
    const result = await executeWorkflow(
      checkout,
      { source: "manual", body: SAMPLE_ORDER },
      deps({ fetch: fakeFetch(() => Response.json({ error: "boom" }, { status: 502 })) as unknown as typeof fetch }),
    );
    expect(result.status).toBe("failed");
    expect(result.error).toBe("Auth & Customer Verify: upstream responded 502");
    expect(statuses(result.steps)).toMatchObject({ "node-2": "failed", "node-3": "skipped", "node-4": "skipped" });
    expect(result.steps[1].output).toMatchObject({ status: 502, body: { error: "boom" } });
  });

  it("fails clearly when a referenced env variable is missing", async () => {
    const result = await executeWorkflow(checkout, { source: "manual", body: SAMPLE_ORDER }, deps({ env: () => undefined }));
    expect(result.status).toBe("failed");
    expect(result.steps[1].error).toBe('environment variable "STRIPE_SECRET" is not configured');
  });

  it("reports timeouts", async () => {
    const hanging = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_, reject) =>
          init.signal?.addEventListener("abort", () => reject(init.signal!.reason)),
        ),
    );
    const flow: WorkflowInput = {
      ...checkout,
      nodes: checkout.nodes.map((n) => (n.type === "http" ? { ...n, config: { ...n.config, timeoutMs: 100 } } : n)),
    };
    const result = await executeWorkflow(flow, { source: "manual", body: SAMPLE_ORDER }, deps({ fetch: hanging as unknown as typeof fetch }));
    expect(result.steps[1].error).toBe("request failed: timed out after 100ms");
  });

  it("produces run output from a response node", async () => {
    const flow: WorkflowInput = {
      name: "echo",
      nodes: [
        { id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/echo" } },
        {
          id: "map",
          name: "Map",
          type: "transform",
          position: { x: 0, y: 0 },
          config: { output: { total: "{{in.body.amount}}", label: "order {{in.body.id}}" } },
        },
        {
          id: "out",
          name: "Out",
          type: "response",
          position: { x: 0, y: 0 },
          config: { status: 202, body: '{ "total": {{map.total}}, "label": "{{map.label}}" }' },
        },
      ],
      edges: [
        { id: "a", source: "in", sourcePort: "out", target: "map" },
        { id: "b", source: "map", sourcePort: "out", target: "out" },
      ],
    };
    expect(validateGraph(flow)).toEqual([]);
    const result = await executeWorkflow(flow, { source: "webhook", body: SAMPLE_ORDER }, deps());
    expect(result.output).toEqual({ status: 202, body: { total: 749.5, label: "order ord_9941a" } });
  });
});

describe("disabled nodes", () => {
  const node = (id: string, type: "transform" | "condition" | "response", config: object, extra: object = {}) =>
    ({ id, name: id, type, position: { x: 0, y: 0 }, config, ...extra }) as WorkflowInput["nodes"][number];
  const flow = (nodes: WorkflowInput["nodes"], edges: [string, string, string][]): WorkflowInput => ({
    name: "d",
    nodes: [{ id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/d" } }, ...nodes],
    edges: edges.map(([source, sourcePort, target], i) => ({ id: `e${i}`, source, sourcePort, target })),
  });

  it("are bypassed: not executed, and the run continues to the next nodes", async () => {
    const wf = flow(
      [
        node("a", "transform", { output: { x: "{{in.body.amount}}" } }, { disabled: true }),
        node("b", "transform", { output: { y: "{{in.body.id}}" } }),
      ],
      [
        ["in", "out", "a"],
        ["a", "out", "b"],
      ],
    );
    expect(validateGraph(wf)).toEqual([]);
    const result = await executeWorkflow(wf, { source: "manual", body: SAMPLE_ORDER }, deps());
    expect(result.status).toBe("succeeded");
    expect(result.steps.map((s) => [s.nodeId, s.status, s.disabled ?? false])).toEqual([
      ["in", "succeeded", false],
      ["a", "skipped", true],
      ["b", "succeeded", false],
    ]);
    expect(result.steps[1].output).toBeUndefined();
  });

  it("a disabled condition continues down both branches", async () => {
    const wf = flow(
      [
        node("check", "condition", { left: "{{in.body.amount}}", operator: ">", right: "1000000" }, { disabled: true }),
        node("yes", "transform", { output: { a: "1" } }),
        node("no", "transform", { output: { b: "2" } }),
      ],
      [
        ["in", "out", "check"],
        ["check", "true", "yes"],
        ["check", "false", "no"],
      ],
    );
    const result = await executeWorkflow(wf, { source: "manual", body: SAMPLE_ORDER }, deps());
    expect(statuses(result.steps)).toEqual({ in: "succeeded", check: "skipped", yes: "succeeded", no: "succeeded" });
  });

  it("a disabled http node sends nothing; a disabled response gives no output", async () => {
    const fetch = fakeFetch(() => Response.json({}));
    const wf = flow(
      [
        {
          id: "call",
          name: "call",
          type: "http",
          position: { x: 0, y: 0 },
          disabled: true,
          config: { method: "POST", url: "https://x.test", headers: {}, timeoutMs: 1000 },
        },
        node("out", "response", { status: 201, body: "{}" }, { disabled: true }),
      ],
      [
        ["in", "out", "call"],
        ["call", "out", "out"],
      ],
    );
    const result = await executeWorkflow(wf, { source: "manual" }, deps({ fetch: fetch as unknown as typeof globalThis.fetch }));
    expect(fetch).not.toHaveBeenCalled();
    expect(result.output).toBeUndefined();
  });

  it("the trigger can't be disabled", () => {
    const wf = flow([], []);
    wf.nodes[0] = { ...wf.nodes[0], disabled: true };
    expect(validateGraph(wf)).toEqual([{ path: "nodes.0.disabled", message: "the webhook trigger can't be disabled" }]);
  });
});

describe("repeat until", () => {
  const polling = (repeat: Partial<NonNullable<Extract<WorkflowInput["nodes"][number], { type: "http" }>["config"]["repeat"]>> = {}): WorkflowInput => ({
    name: "Payroll",
    nodes: [
      { id: "trigger", name: "Trigger", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/p" } },
      {
        id: "http-2",
        name: "GetBatchList",
        type: "http",
        position: { x: 1, y: 0 },
        config: {
          method: "GET",
          url: "https://bank.test/batches",
          headers: {},
          timeoutMs: 1000,
          repeat: { mode: "compare", left: "{{http-2.body.status}}", operator: "==", right: "COMPLETED", intervalMs: 2000, maxAttempts: 5, ...repeat },
        },
      },
      { id: "http-3", name: "GetBatchData", type: "http", position: { x: 2, y: 0 }, config: { method: "GET", url: "https://bank.test/data", headers: {}, timeoutMs: 1000 } },
    ],
    edges: [
      { id: "e1", source: "trigger", sourcePort: "out", target: "http-2" },
      { id: "e2", source: "http-2", sourcePort: "out", target: "http-3" },
    ],
  });

  it("sends again until the condition is true, then continues", async () => {
    const statusesSeen = ["PENDING", "PROCESSING", "COMPLETED"];
    let calls = 0;
    const waits: number[] = [];
    const events: unknown[] = [];
    const fetch = fakeFetch((url) => (url.endsWith("/batches") ? Response.json({ status: statusesSeen[calls++] }) : Response.json({ rows: 3 })));
    const result = await executeWorkflow(polling(), { source: "manual" }, deps({
      fetch: fetch as unknown as typeof globalThis.fetch,
      sleep: async (ms) => void waits.push(ms),
      onProgress: (e) => e.type === "attempt" && events.push(e),
    }));
    expect(result.status).toBe("succeeded");
    expect(calls).toBe(3);
    expect(waits).toEqual([2000, 2000]);
    expect(events).toEqual([
      { type: "attempt", nodeId: "http-2", attempt: 1, maxAttempts: 5, waitMs: 2000, logs: ['{{http-2.body.status}} = "PENDING"'] },
      { type: "attempt", nodeId: "http-2", attempt: 2, maxAttempts: 5, waitMs: 2000, logs: ['{{http-2.body.status}} = "PROCESSING"'] },
    ]);
    const step = result.steps.find((s) => s.nodeId === "http-2")!;
    expect(step.checks).toEqual([
      { attempt: 1, met: false, logs: ['{{http-2.body.status}} = "PENDING"'] },
      { attempt: 2, met: false, logs: ['{{http-2.body.status}} = "PROCESSING"'] },
      { attempt: 3, met: true, logs: ['{{http-2.body.status}} = "COMPLETED"'] },
    ]);
    expect(step.attempts).toBe(3);
    expect((step.output as { body: unknown }).body).toEqual({ status: "COMPLETED" });
    expect(statuses(result.steps)["http-3"]).toBe("succeeded");
  });

  it("fails the step after the last attempt and skips the rest", async () => {
    const fetch = fakeFetch(() => Response.json({ status: "PENDING" }));
    const result = await executeWorkflow(polling({ maxAttempts: 3 }), { source: "manual" }, deps({ fetch: fetch as unknown as typeof globalThis.fetch }));
    expect(result.status).toBe("failed");
    const step = result.steps.find((s) => s.nodeId === "http-2")!;
    expect(step.attempts).toBe(3);
    expect(step.error).toBe('condition not met after 3 attempts: {{http-2.body.status}} was "PENDING", expected == "COMPLETED"');
    expect(statuses(result.steps)["http-3"]).toBe("skipped");
  });

  it("validates the wait limit and an empty condition", async () => {
    const { httpNodeSchema } = await import("./schema");
    const node = polling().nodes[1];
    expect(httpNodeSchema.safeParse({ ...node, config: { ...node.config, repeat: { left: "x", operator: "exists", intervalMs: 60_000, maxAttempts: 12 } } }).success).toBe(false);
    expect(httpNodeSchema.safeParse({ ...node, config: { ...node.config, repeat: { left: "x", operator: "exists", intervalMs: 60_000, maxAttempts: 11 } } }).success).toBe(true);
    const result = await executeWorkflow(polling({ left: " " }), { source: "manual" }, deps());
    expect(result.error).toMatch(/has no condition/);
  });
});

describe("repeat until (script)", () => {
  it("asks checkCondition after each send and continues once it's met", async () => {
    let calls = 0;
    const seen: unknown[] = [];
    const fetch = fakeFetch(() => Response.json({ data: [{ status: calls++ < 1 ? 1 : 2 }] }));
    const wf: WorkflowInput = {
      name: "P",
      nodes: [
        { id: "t", name: "T", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/p" } },
        {
          id: "http-2",
          name: "GetBatchList",
          type: "http",
          position: { x: 1, y: 0 },
          config: { method: "GET", url: "https://bank.test/b", headers: {}, timeoutMs: 1000, repeat: { mode: "script", script: "check", left: "", operator: "==", intervalMs: 500, maxAttempts: 4 } },
        },
      ],
      edges: [{ id: "e", source: "t", sourcePort: "out", target: "http-2" }],
    };
    const result = await executeWorkflow(wf, { source: "manual" }, deps({
      fetch: fetch as unknown as typeof globalThis.fetch,
      checkCondition: async (code, output) => {
        seen.push(code);
        return { met: ((output as { body: { data: { status: number }[] } }).body.data[0].status === 2) as true | false } as { met: true } | { met: false };
      },
    }));
    expect(result.status).toBe("succeeded");
    expect(seen).toEqual(["check", "check"]);
    expect(result.steps[1].attempts).toBe(2);

    const failing = await executeWorkflow(wf, { source: "manual" }, deps({ fetch: fetch as unknown as typeof globalThis.fetch, checkCondition: async () => ({ error: "boom" }) }));
    expect(failing.steps[1]).toMatchObject({ status: "failed", error: "boom", attempts: 1 });
  });

  it("runs a script node with the run so far and passes its output on", async () => {
    const wf: WorkflowInput = {
      name: "script",
      nodes: [
        { id: "trigger", name: "T", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/x" } },
        { id: "script-1", name: "Prepare", type: "script", position: { x: 0, y: 0 }, config: { code: "return { total: trigger.body.a + 1 };" } },
        { id: "out", name: "Out", type: "response", position: { x: 0, y: 0 }, config: { status: 200, body: '{ "total": "{{script-1.total}}" }' } },
      ],
      edges: [
        { id: "e1", source: "trigger", sourcePort: "out", target: "script-1" },
        { id: "e2", source: "script-1", sourcePort: "out", target: "out" },
      ],
    };
    const seen: unknown[] = [];
    const runScript: EngineDeps["runScript"] = async (code, context) => {
      seen.push(context);
      return code.includes("total") ? { output: { total: 42 }, logs: ["hi"] } : { error: "boom" };
    };
    const ok = await executeWorkflow(wf, { source: "manual", body: { a: 41 } }, deps({ runScript }));
    expect(seen[0]).toMatchObject({ trigger: { body: { a: 41 } }, nodes: { trigger: { body: { a: 41 } } } });
    expect(ok.steps[1]).toMatchObject({ status: "succeeded", output: { total: 42 }, logs: ["hi"] });
    expect(ok.output).toEqual({ status: 200, body: { total: "42" } });

    wf.nodes[1] = { ...wf.nodes[1], config: { code: "throw 1" } } as WorkflowInput["nodes"][number];
    const failed = await executeWorkflow(wf, { source: "manual", body: { a: 1 } }, deps({ runScript }));
    expect(failed.steps[1]).toMatchObject({ status: "failed", error: "boom" });
    expect(failed.steps[2].status).toBe("skipped");
  });
});
