import { describe, expect, it } from "vitest";
import type { Run, Step } from "@/lib/workflows/schema";
import { computeTelemetry, rootCause } from "./compute";

const NOW = Date.parse("2026-11-05T12:00:00Z");
const SINCE = new Date(NOW - 24 * 3_600_000).toISOString();

function step(nodeId: string, status: Step["status"], durationMs: number, extra: Partial<Step> = {}): Step {
  return { nodeId, nodeType: "http", name: nodeId.toUpperCase(), status, startedAt: "", durationMs, ...extra };
}

let n = 0;
function run(hoursAgo: number, status: Run["status"], durationMs: number, steps: Step[], workflowId = "wf_a"): Run {
  n += 1;
  const startedAt = new Date(NOW - hoursAgo * 3_600_000).toISOString();
  return {
    id: `run_${n}`,
    workflowId,
    workflowVersion: 1,
    environment: "sandbox",
    status,
    trigger: { source: "manual" },
    startedAt,
    finishedAt: startedAt,
    durationMs,
    steps,
  };
}

const ok = (hoursAgo: number, ms = 100) =>
  run(hoursAgo, "succeeded", ms, [
    step("in", "succeeded", 0, { nodeType: "webhook" }),
    step("call", "succeeded", ms - 10, { request: { method: "GET", url: "https://api.stripe.test/v1/x", headers: {} } }),
    step("map", "succeeded", 10, { nodeType: "transform" }),
  ]);
const fail = (hoursAgo: number, error: string, status?: number) =>
  run(hoursAgo, "failed", 300, [
    step("in", "succeeded", 0, { nodeType: "webhook" }),
    step("call", "failed", 300, {
      error,
      request: { method: "GET", url: "https://api.stripe.test/v1/x", headers: {} },
      ...(status ? { output: { status } } : {}),
    }),
    step("map", "skipped", 0, { nodeType: "transform" }),
  ]);

describe("rootCause", () => {
  it("groups step errors into readable causes", () => {
    expect(rootCause("upstream responded 503")).toBe("HTTP 503");
    expect(rootCause("request failed: timed out after 100ms")).toBe("Timeout");
    expect(rootCause("request failed: blocked: 10.0.0.1 is a private network address")).toBe("Blocked by network policy");
    expect(rootCause("request failed: getaddrinfo ENOTFOUND x")).toBe("Network error");
    expect(rootCause("2 tests failed: a, b")).toBe("Test failed");
    expect(rootCause("post-response script (request “X”) failed: boom")).toBe("Script error");
    expect(rootCause('environment variable "TOKEN" is not configured')).toBe("Missing variable or template");
    expect(rootCause('cannot compare non-numeric values with ">": undefined vs "500"')).toBe("Condition on missing data");
    expect(rootCause("something odd")).toBe("Other");
  });
});

describe("computeTelemetry", () => {
  // Newest first, like queryRuns.
  const runs = [
    ok(0.1, 120),
    fail(0.2, "upstream responded 503", 503),
    fail(0.3, "upstream responded 503", 503),
    fail(0.4, "request failed: timed out after 5000ms"),
    ok(0.5, 80),
    ok(5, 100),
    ok(20, 100),
    run(1, "succeeded", 50, [step("in", "succeeded", 0, { nodeType: "webhook" })], "wf_b"),
  ].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const t = computeTelemetry(runs, {
    window: "24h",
    since: SINCE,
    now: NOW,
    previousRuns: 4,
    sampled: false,
    names: new Map([
      ["wf_a", "Checkout"],
      ["wf_b", "Other flow"],
    ]),
  });

  it("totals, trend and latency", () => {
    expect(t.totals).toEqual({ runs: 8, succeeded: 5, failed: 3, successRate: 5 / 8, previousRuns: 4, changePct: 100 });
    expect(t.latency).toEqual({ avg: 169, p50: 100, p95: 300, p99: 300 });
  });

  it("hourly buckets with peak and failure spikes", () => {
    expect(t.bucketMinutes).toBe(60);
    expect(t.buckets).toHaveLength(24);
    const last = t.buckets.at(-1)!;
    // The wf_b run 1h ago falls on the last bucket's start.
    expect([last.succeeded, last.failed]).toEqual([3, 3]);
    expect(t.peak).toEqual({ start: last.start, runs: 6 });
    expect(t.spikes).toEqual({ count: 1, last: { start: last.start, failed: 3, runs: 6 } });
  });

  it("root causes, upstream hosts and workflows", () => {
    expect(t.rootCauses).toEqual([
      { label: "HTTP 503", count: 2 },
      { label: "Timeout", count: 1 },
    ]);
    expect(t.upstreams).toEqual([{ host: "api.stripe.test", calls: 7, failed: 3, avgMs: 180, p95Ms: 300 }]);
    expect(t.workflows.map((w) => [w.name, w.runs, w.failed])).toEqual([
      ["Checkout", 7, 3],
      ["Other flow", 1, 0],
    ]);
  });

  it("per-node pipeline of the busiest workflow, skipped steps excluded", () => {
    expect(t.pipeline!.workflowName).toBe("Checkout");
    expect(t.pipeline!.runs).toBe(7);
    expect(t.pipeline!.nodes.map((x) => [x.nodeId, x.calls, x.failed])).toEqual([
      ["in", 7, 0],
      ["call", 7, 3],
      ["map", 4, 0],
    ]);
    const call = t.pipeline!.nodes[1];
    expect(call.sharePct).toBeGreaterThan(90);
  });

  it("recent runs with the failing step and its HTTP status", () => {
    expect(t.recent).toHaveLength(8);
    expect(t.recent[0]).toMatchObject({ workflowName: "Checkout", status: "succeeded", executed: 3 });
    expect(t.recent[1].failedStep).toEqual({ name: "CALL", error: "upstream responded 503", httpStatus: 503 });
  });

  it("is empty but well-formed without runs", () => {
    const empty = computeTelemetry([], { window: "7d", since: new Date(NOW - 7 * 86_400_000).toISOString(), now: NOW, previousRuns: 0, sampled: false, names: new Map() });
    expect(empty.totals.successRate).toBeNull();
    expect(empty.latency).toBeNull();
    expect(empty.buckets).toHaveLength(28);
    expect(empty.pipeline).toBeNull();
    expect(empty.peak).toBeNull();
  });
});
