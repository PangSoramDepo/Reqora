import { beforeAll, describe, expect, it } from "vitest";
import type { WorkflowInput } from "@/lib/workflows/schema";
import { LoadMetrics, Reservoir, verdictOf } from "./metrics";
import { loadTestConfigSchema } from "./schema";

process.env.REQORA_DB_PATH = ":memory:";

let runner: typeof import("./runner");
let workflows: typeof import("@/lib/workflows/store");

beforeAll(async () => {
  workflows = await import("@/lib/workflows/store");
  runner = await import("./runner");
});

const step = (nodeId: string, status: "succeeded" | "failed" | "skipped", durationMs: number, error?: string) => ({
  nodeId,
  nodeType: "http" as const,
  name: nodeId,
  status,
  startedAt: "",
  durationMs,
  ...(error ? { error } : {}),
});

describe("Reservoir", () => {
  it("gives exact nearest-rank percentiles while under capacity", () => {
    const r = new Reservoir(1000);
    for (let i = 1; i <= 100; i++) r.add(i);
    expect(r.stats()).toEqual({ min: 1, avg: 51, p50: 50, p90: 90, p95: 95, p99: 99, max: 100 });
  });

  it("keeps memory bounded but exact count, min and max", () => {
    const r = new Reservoir(50);
    for (let i = 1; i <= 10_000; i++) r.add(i);
    const stats = r.stats()!;
    expect(r.count).toBe(10_000);
    expect([stats.min, stats.max]).toEqual([1, 10_000]);
    expect(stats.p50).toBeGreaterThan(1000);
    expect(stats.p50).toBeLessThan(9000);
  });
});

describe("LoadMetrics", () => {
  it("aggregates runs, per-node stats, per-second timeline and top errors", () => {
    const m = new LoadMetrics(0);
    m.setActive(2, 0);
    m.record({ status: "succeeded", durationMs: 100, steps: [step("a", "succeeded", 60), step("b", "succeeded", 40)] }, 500);
    m.record({ status: "failed", durationMs: 300, steps: [step("a", "succeeded", 50), step("b", "failed", 250, "upstream responded 503")] }, 1500);
    m.record({ status: "failed", durationMs: 200, steps: [step("a", "failed", 200, "timed out"), step("b", "skipped", 0)] }, 1600);
    const s = m.snapshot(2000);
    expect(s.iterations).toEqual({ completed: 3, succeeded: 1, failed: 2 });
    expect(s.errorRatePct).toBe(66.67);
    expect(s.throughput).toBe(1.5);
    expect(s.nodes.map((n) => [n.nodeId, n.calls, n.failed])).toEqual([
      ["a", 3, 1],
      ["b", 2, 1],
    ]);
    expect(s.timeline.slice(0, 2).map((t) => [t.second, t.succeeded, t.failed, t.activeVirtualUsers])).toEqual([
      [0, 1, 0, 2],
      [1, 0, 2, 2],
    ]);
    expect(s.errors).toEqual([
      { message: "b: upstream responded 503", count: 1 },
      { message: "a: timed out", count: 1 },
    ]);
  });
});

describe("verdictOf", () => {
  const result = { errorRatePct: 2.5, latency: { min: 1, avg: 50, p50: 40, p90: 90, p95: 120, p99: 200, max: 300 }, iterations: { completed: 10 } };
  it("is undefined without thresholds", () => expect(verdictOf({}, result)).toBeUndefined());
  it("passes and fails on error rate and p95", () => {
    expect(verdictOf({ maxErrorRatePct: 5, p95Ms: 150 }, result)).toEqual({ passed: true, reasons: [] });
    expect(verdictOf({ maxErrorRatePct: 1, p95Ms: 100 }, result)).toEqual({
      passed: false,
      reasons: ["error rate 2.5% is above 1%", "p95 120ms is above 100ms"],
    });
  });
});

describe("loadTestConfigSchema", () => {
  it("applies defaults and rejects fewer iterations than virtual users", () => {
    expect(loadTestConfigSchema.parse({ virtualUsers: 5 })).toMatchObject({ mode: "iterations", iterations: 100, rampUpSec: 0 });
    expect(loadTestConfigSchema.safeParse({ virtualUsers: 10, iterations: 5 }).success).toBe(false);
    expect(loadTestConfigSchema.safeParse({ virtualUsers: 201 }).success).toBe(false);
  });
});

const flow: WorkflowInput = {
  name: "load",
  nodes: [
    { id: "in", name: "In", type: "webhook", position: { x: 0, y: 0 }, config: { method: "POST", path: "/in" } },
    {
      id: "call",
      name: "Call",
      type: "http",
      position: { x: 0, y: 0 },
      config: { method: "POST", url: "https://api.test/orders", headers: {}, body: '{ "id": "{{trigger.body.id}}" }', timeoutMs: 5_000 },
    },
  ],
  edges: [{ id: "e", source: "in", sourcePort: "out", target: "call" }],
};

/** A fake upstream that tracks how many requests are in flight at once. */
function upstream(delayMs: number, status = (n: number) => (n % 5 === 0 ? 500 : 200)) {
  const state = { calls: 0, inFlight: 0, peak: 0 };
  const fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    state.calls += 1;
    const n = state.calls;
    state.inFlight += 1;
    state.peak = Math.max(state.peak, state.inFlight);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        });
      });
      return Response.json({ ok: true }, { status: status(n) });
    } finally {
      state.inFlight -= 1;
    }
  }) as typeof globalThis.fetch;
  return { state, fetch };
}

describe("startLoadTest", () => {
  it("runs the iteration budget with the configured concurrency and stores the report", async () => {
    const wf = workflows.createWorkflow("ws_default", flow);
    const { state, fetch } = upstream(20);
    const config = loadTestConfigSchema.parse({ virtualUsers: 5, iterations: 40, thresholds: { maxErrorRatePct: 10 } });
    const started = runner.startLoadTest(wf, config, { baseUrl: "http://reqora.test", fetch });
    if (!started.ok) throw new Error("not started");
    expect(started.test.status).toBe("running");

    const final = await runner.waitForLoadTest(started.test.id)!;
    expect(state.calls).toBe(40);
    expect(state.peak).toBe(5);
    expect(final.status).toBe("completed");
    expect(final.iterations).toEqual({ completed: 40, succeeded: 32, failed: 8 });
    expect(final.errorRatePct).toBe(20);
    expect(final.verdict).toEqual({ passed: false, reasons: ["error rate 20% is above 10%"] });
    expect(final.errors[0]).toEqual({ message: "Call: upstream responded 500", count: 8 });
    expect(final.latency!.min).toBeGreaterThanOrEqual(15);
    expect(final.activeVirtualUsers).toBe(0);

    // Stored, and listed for the workflow; runs are not in Execution History.
    expect(runner.getLoadTest(started.test.id)).toEqual(final);
    expect(runner.listLoadTests(wf.id).map((t) => t.id)).toEqual([started.test.id]);
    expect(workflows.listRuns(wf.id, 10)).toEqual([]);
  });

  it("stops on request, cancelling runs in flight", async () => {
    const wf = workflows.createWorkflow("ws_default", flow);
    const { fetch } = upstream(50, () => 200);
    const config = loadTestConfigSchema.parse({ virtualUsers: 3, mode: "duration", durationSec: 60 });
    const started = runner.startLoadTest(wf, config, { baseUrl: "http://reqora.test", fetch });
    if (!started.ok) throw new Error("not started");
    await new Promise((r) => setTimeout(r, 180));
    const t0 = Date.now();
    const final = await runner.stopLoadTest(started.test.id);
    expect(Date.now() - t0).toBeLessThan(500);
    expect(final!.status).toBe("stopped");
    expect(final!.iterations.failed).toBe(0); // cancelled runs are left out, not counted as failures
    expect(final!.iterations.completed).toBeGreaterThan(0);
  });

  it("limits how many tests run at once", async () => {
    const wf = workflows.createWorkflow("ws_default", flow);
    const { fetch } = upstream(30, () => 200);
    const config = loadTestConfigSchema.parse({ virtualUsers: 1, mode: "duration", durationSec: 60 });
    const ids = Array.from({ length: runner.MAX_RUNNING }, () => runner.startLoadTest(wf, config, { baseUrl: "http://x", fetch }));
    expect(ids.every((r) => r.ok)).toBe(true);
    expect(runner.startLoadTest(wf, config, { baseUrl: "http://x", fetch })).toEqual({ ok: false, reason: "busy" });
    await Promise.all(ids.map((r) => r.ok && runner.stopLoadTest(r.test.id)));
    expect(runner.runningCount()).toBe(0);
  });
});
