import type { ExecutionResult } from "@/lib/workflows/engine";
import type { NodeType } from "@/lib/workflows/schema";
import type { LatencyStats, LoadTest } from "./schema";

/**
 * Latency samples with bounded memory: exact count/sum/min/max, and a uniform reservoir sample for percentiles
 * (exact until `capacity` samples).
 */
export class Reservoir {
  count = 0;
  private sum = 0;
  private min = Infinity;
  private max = -Infinity;
  private samples: number[] = [];

  constructor(
    private readonly capacity: number,
    private readonly random: () => number = Math.random,
  ) {}

  add(value: number) {
    this.count += 1;
    this.sum += value;
    this.min = Math.min(this.min, value);
    this.max = Math.max(this.max, value);
    if (this.samples.length < this.capacity) this.samples.push(value);
    else {
      const slot = Math.floor(this.random() * this.count);
      if (slot < this.capacity) this.samples[slot] = value;
    }
  }

  percentile(sorted: number[], p: number) {
    // Nearest-rank.
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  }

  stats(): LatencyStats | null {
    if (this.count === 0) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      min: this.min,
      avg: Math.round(this.sum / this.count),
      p50: this.percentile(sorted, 50),
      p90: this.percentile(sorted, 90),
      p95: this.percentile(sorted, 95),
      p99: this.percentile(sorted, 99),
      max: this.max,
    };
  }
}

const MAX_ERROR_KINDS = 200;
const TOP_ERRORS = 10;

type Second = { succeeded: number; failed: number; latency: Reservoir; activeVirtualUsers: number };

/** Aggregates flow runs of a load test into the numbers the report shows. */
export class LoadMetrics {
  private readonly overall = new Reservoir(20_000);
  private readonly nodes = new Map<string, { name: string; type: NodeType; calls: number; failed: number; latency: Reservoir }>();
  private readonly seconds: Second[] = [];
  private readonly errors = new Map<string, number>();
  succeeded = 0;
  failed = 0;
  active = 0;

  constructor(private readonly startMs: number) {}

  private second(atMs: number): Second {
    const index = Math.max(0, Math.floor((atMs - this.startMs) / 1000));
    while (this.seconds.length <= index) {
      this.seconds.push({ succeeded: 0, failed: 0, latency: new Reservoir(500), activeVirtualUsers: this.active });
    }
    return this.seconds[index];
  }

  setActive(delta: number, atMs: number) {
    this.active += delta;
    const s = this.second(atMs);
    s.activeVirtualUsers = Math.max(s.activeVirtualUsers, this.active);
  }

  /** One finished flow run, bucketed by the second it finished in. */
  record(result: Pick<ExecutionResult, "status" | "durationMs" | "steps" | "error">, finishedMs: number) {
    const ok = result.status === "succeeded";
    if (ok) this.succeeded += 1;
    else this.failed += 1;
    this.overall.add(result.durationMs);
    const s = this.second(finishedMs);
    if (ok) s.succeeded += 1;
    else s.failed += 1;
    s.latency.add(result.durationMs);

    for (const step of result.steps) {
      if (step.status === "skipped") continue;
      let node = this.nodes.get(step.nodeId);
      if (!node) {
        node = { name: step.name, type: step.nodeType, calls: 0, failed: 0, latency: new Reservoir(5_000) };
        this.nodes.set(step.nodeId, node);
      }
      node.calls += 1;
      node.latency.add(step.durationMs);
      if (step.status === "failed") node.failed += 1;
    }

    if (!ok) {
      const failedStep = result.steps.find((st) => st.status === "failed");
      const message = (failedStep ? `${failedStep.name}: ${failedStep.error ?? "failed"}` : (result.error ?? "run failed")).slice(0, 300);
      if (this.errors.has(message) || this.errors.size < MAX_ERROR_KINDS) this.errors.set(message, (this.errors.get(message) ?? 0) + 1);
      else this.errors.set("Other errors", (this.errors.get("Other errors") ?? 0) + 1);
    }
  }

  /** The metric part of a report, as of `nowMs`. */
  snapshot(nowMs: number): Pick<
    LoadTest,
    "elapsedMs" | "activeVirtualUsers" | "iterations" | "throughput" | "errorRatePct" | "latency" | "nodes" | "timeline" | "errors"
  > {
    const completed = this.succeeded + this.failed;
    const elapsedMs = Math.max(0, nowMs - this.startMs);
    // Make sure the timeline reaches "now" even through quiet seconds.
    if (completed > 0 || this.active > 0) this.second(nowMs);
    return {
      elapsedMs,
      activeVirtualUsers: this.active,
      iterations: { completed, succeeded: this.succeeded, failed: this.failed },
      throughput: elapsedMs > 0 ? Math.round((completed / (elapsedMs / 1000)) * 100) / 100 : 0,
      errorRatePct: completed ? Math.round((this.failed / completed) * 10_000) / 100 : 0,
      latency: this.overall.stats(),
      nodes: [...this.nodes].map(([nodeId, n]) => ({
        nodeId,
        name: n.name,
        type: n.type,
        calls: n.calls,
        failed: n.failed,
        latency: n.latency.stats(),
      })),
      timeline: this.seconds.map((s, second) => ({
        second,
        succeeded: s.succeeded,
        failed: s.failed,
        p95Ms: s.latency.stats()?.p95 ?? null,
        activeVirtualUsers: s.activeVirtualUsers,
      })),
      errors: [...this.errors]
        .map(([message, count]) => ({ message, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_ERRORS),
    };
  }
}

/** Threshold check for a finished test; undefined when no thresholds were set. */
export function verdictOf(
  thresholds: { maxErrorRatePct?: number; p95Ms?: number },
  result: { errorRatePct: number; latency: LatencyStats | null; iterations: { completed: number } },
): { passed: boolean; reasons: string[] } | undefined {
  if (thresholds.maxErrorRatePct === undefined && thresholds.p95Ms === undefined) return undefined;
  const reasons: string[] = [];
  if (result.iterations.completed === 0) reasons.push("no iterations completed");
  if (thresholds.maxErrorRatePct !== undefined && result.errorRatePct > thresholds.maxErrorRatePct) {
    reasons.push(`error rate ${result.errorRatePct}% is above ${thresholds.maxErrorRatePct}%`);
  }
  if (thresholds.p95Ms !== undefined && result.latency && result.latency.p95 > thresholds.p95Ms) {
    reasons.push(`p95 ${result.latency.p95}ms is above ${thresholds.p95Ms}ms`);
  }
  return { passed: reasons.length === 0, reasons };
}
