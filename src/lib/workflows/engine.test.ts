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

  it("never records resolved secrets in step requests", async () => {
    const result = await executeWorkflow(checkout, { source: "manual", body: SAMPLE_ORDER }, deps());
    const verify = result.steps.find((s) => s.nodeId === "node-2")!;
    expect(verify.request?.headers.Authorization).toBe("Bearer {{env.STRIPE_SECRET}}");
    expect(JSON.stringify(result)).not.toContain("sk_test");
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
