import type { Run, RunWindow, Step } from "@/lib/workflows/schema";

// Keep in sync with api/openapi.yaml (Telemetry).

export type Telemetry = {
  window: RunWindow;
  since: string;
  generatedAt: string;
  /** True when the window had more runs than were analysed (the newest ones are used). */
  sampled: boolean;
  totals: { runs: number; succeeded: number; failed: number; successRate: number | null; previousRuns: number; changePct: number | null };
  latency: { avg: number; p50: number; p95: number; p99: number } | null;
  bucketMinutes: number;
  buckets: { start: string; succeeded: number; failed: number }[];
  /** Busiest bucket. */
  peak: { start: string; runs: number } | null;
  /** Buckets where at least 3 runs and 20% of runs failed. */
  spikes: { count: number; last: { start: string; failed: number; runs: number } | null };
  rootCauses: { label: string; count: number }[];
  /** External APIs called by workflow HTTP steps, by host. */
  upstreams: { host: string; calls: number; failed: number; avgMs: number; p95Ms: number }[];
  workflows: { id: string; name: string; runs: number; failed: number }[];
  pipeline: {
    workflowId: string;
    workflowName: string;
    runs: number;
    avgRunMs: number;
    nodes: { nodeId: string; name: string; type: Step["nodeType"]; calls: number; failed: number; avgMs: number; p95Ms: number; sharePct: number }[];
  } | null;
  recent: {
    id: string;
    workflowId: string;
    workflowName: string;
    status: Run["status"];
    startedAt: string;
    durationMs: number;
    environment: Run["environment"];
    source: Run["trigger"]["source"];
    executed: number;
    failedStep?: { name: string; error: string; httpStatus?: number };
  }[];
};

const BUCKET_MINUTES: Record<RunWindow, number> = { "24h": 60, "7d": 360, "30d": 1440 };
const SPIKE_MIN_FAILED = 3;
const SPIKE_MIN_RATE = 0.2;

/** Nearest-rank percentile of a sorted array. */
const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
const sortNum = (values: number[]) => [...values].sort((a, b) => a - b);
const avg = (values: number[]) => Math.round(values.reduce((a, b) => a + b, 0) / values.length);

/** Groups a failed step's error into a readable cause. */
export function rootCause(error: string | undefined): string {
  const e = error ?? "";
  const status = /upstream responded (\d{3})/.exec(e);
  if (status) return `HTTP ${status[1]}`;
  if (/timed out/i.test(e)) return "Timeout";
  if (/blocked: /.test(e)) return "Blocked by network policy";
  if (/tests? failed/.test(e)) return "Test failed";
  if (/script .*failed/.test(e)) return "Script error";
  if (/environment variable|template|is not configured|unknown (node|reference)|cannot read/i.test(e)) return "Missing variable or template";
  if (/linked (Collections )?request/.test(e)) return "Linked request problem";
  if (/cannot compare/.test(e)) return "Condition on missing data";
  if (/request failed/.test(e)) return "Network error";
  return "Other";
}

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

const failedStepOf = (run: Run) => run.steps.find((s) => s.status === "failed");

/**
 * Aggregates the window's runs (newest first) into the Telemetry page's numbers. `pipelineWorkflowId` picks the
 * workflow for the per-node breakdown (default: the one with the most runs).
 */
export function computeTelemetry(
  runs: Run[],
  options: {
    window: RunWindow;
    since: string;
    now: number;
    previousRuns: number;
    sampled: boolean;
    names: Map<string, string>;
    pipelineWorkflowId?: string;
  },
): Telemetry {
  const { window, since, now, names } = options;
  const succeeded = runs.filter((r) => r.status === "succeeded").length;
  const failed = runs.length - succeeded;
  const durations = sortNum(runs.map((r) => r.durationMs));

  // Time buckets from `since` to now.
  const bucketMs = BUCKET_MINUTES[window] * 60_000;
  const start = Date.parse(since);
  const count = Math.max(1, Math.ceil((now - start) / bucketMs));
  const buckets = Array.from({ length: count }, (_, i) => ({ start: new Date(start + i * bucketMs).toISOString(), succeeded: 0, failed: 0 }));
  for (const run of runs) {
    const i = Math.floor((Date.parse(run.startedAt) - start) / bucketMs);
    const b = buckets[Math.min(Math.max(i, 0), count - 1)];
    if (run.status === "succeeded") b.succeeded += 1;
    else b.failed += 1;
  }
  const peakBucket = buckets.reduce<(typeof buckets)[number] | null>(
    (best, b) => (b.succeeded + b.failed > (best ? best.succeeded + best.failed : 0) ? b : best),
    null,
  );
  const spikeBuckets = buckets.filter((b) => b.failed >= SPIKE_MIN_FAILED && b.failed / (b.succeeded + b.failed) >= SPIKE_MIN_RATE);
  const lastSpike = spikeBuckets.at(-1);

  // Root causes of failed runs.
  const causes = new Map<string, number>();
  for (const run of runs) {
    if (run.status !== "failed") continue;
    const label = rootCause(failedStepOf(run)?.error ?? run.error);
    causes.set(label, (causes.get(label) ?? 0) + 1);
  }

  // Upstream hosts from executed HTTP steps.
  const hosts = new Map<string, { calls: number; failed: number; durations: number[] }>();
  for (const run of runs) {
    for (const step of run.steps) {
      if (step.nodeType !== "http" || step.status === "skipped" || !step.request) continue;
      const host = hostOf(step.request.url);
      if (!host) continue;
      const h = hosts.get(host) ?? { calls: 0, failed: 0, durations: [] };
      h.calls += 1;
      if (step.status === "failed") h.failed += 1;
      h.durations.push(step.durationMs);
      hosts.set(host, h);
    }
  }

  // Per workflow.
  const perWorkflow = new Map<string, { runs: number; failed: number }>();
  for (const run of runs) {
    const w = perWorkflow.get(run.workflowId) ?? { runs: 0, failed: 0 };
    w.runs += 1;
    if (run.status === "failed") w.failed += 1;
    perWorkflow.set(run.workflowId, w);
  }
  const workflows = [...perWorkflow]
    .map(([id, w]) => ({ id, name: names.get(id) ?? id, ...w }))
    .sort((a, b) => b.runs - a.runs);

  // Per-node breakdown for one workflow, in execution order of its latest run.
  const pipelineId = options.pipelineWorkflowId && perWorkflow.has(options.pipelineWorkflowId) ? options.pipelineWorkflowId : workflows[0]?.id;
  let pipeline: Telemetry["pipeline"] = null;
  if (pipelineId) {
    const wfRuns = runs.filter((r) => r.workflowId === pipelineId);
    const nodes = new Map<string, { name: string; type: Step["nodeType"]; calls: number; failed: number; durations: number[] }>();
    for (const step of wfRuns[0].steps) nodes.set(step.nodeId, { name: step.name, type: step.nodeType, calls: 0, failed: 0, durations: [] });
    for (const run of wfRuns) {
      for (const step of run.steps) {
        if (step.status === "skipped") continue;
        const n = nodes.get(step.nodeId);
        if (!n) continue; // node no longer in the latest version
        n.calls += 1;
        if (step.status === "failed") n.failed += 1;
        n.durations.push(step.durationMs);
      }
    }
    const avgRunMs = avg(wfRuns.map((r) => r.durationMs));
    pipeline = {
      workflowId: pipelineId,
      workflowName: names.get(pipelineId) ?? pipelineId,
      runs: wfRuns.length,
      avgRunMs,
      nodes: [...nodes]
        .filter(([, n]) => n.calls > 0)
        .map(([nodeId, n]) => {
          const sorted = sortNum(n.durations);
          // Average time per run spent in this node, as a share of the average run.
          const perRun = n.durations.reduce((a, b) => a + b, 0) / wfRuns.length;
          return {
            nodeId,
            name: n.name,
            type: n.type,
            calls: n.calls,
            failed: n.failed,
            avgMs: avg(n.durations),
            p95Ms: pct(sorted, 95),
            sharePct: avgRunMs > 0 ? Math.min(100, Math.round((perRun / avgRunMs) * 100)) : 0,
          };
        }),
    };
  }

  return {
    window,
    since,
    generatedAt: new Date(now).toISOString(),
    sampled: options.sampled,
    totals: {
      runs: runs.length,
      succeeded,
      failed,
      successRate: runs.length ? succeeded / runs.length : null,
      previousRuns: options.previousRuns,
      changePct: options.previousRuns ? Math.round(((runs.length - options.previousRuns) / options.previousRuns) * 1000) / 10 : null,
    },
    latency: durations.length ? { avg: avg(durations), p50: pct(durations, 50), p95: pct(durations, 95), p99: pct(durations, 99) } : null,
    bucketMinutes: BUCKET_MINUTES[window],
    buckets,
    peak: peakBucket ? { start: peakBucket.start, runs: peakBucket.succeeded + peakBucket.failed } : null,
    spikes: {
      count: spikeBuckets.length,
      last: lastSpike ? { start: lastSpike.start, failed: lastSpike.failed, runs: lastSpike.succeeded + lastSpike.failed } : null,
    },
    rootCauses: [...causes].map(([label, n]) => ({ label, count: n })).sort((a, b) => b.count - a.count),
    upstreams: [...hosts]
      .map(([host, h]) => ({ host, calls: h.calls, failed: h.failed, avgMs: avg(h.durations), p95Ms: pct(sortNum(h.durations), 95) }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 8),
    workflows,
    pipeline,
    recent: runs.slice(0, 10).map((run) => {
      const step = failedStepOf(run);
      const status = (step?.output as { status?: number } | undefined)?.status;
      return {
        id: run.id,
        workflowId: run.workflowId,
        workflowName: names.get(run.workflowId) ?? run.workflowId,
        status: run.status,
        startedAt: run.startedAt,
        durationMs: run.durationMs,
        environment: run.environment,
        source: run.trigger.source,
        executed: run.steps.filter((s) => s.status !== "skipped").length,
        ...(step ? { failedStep: { name: step.name, error: step.error ?? "failed", ...(status ? { httpStatus: status } : {}) } } : {}),
      };
    }),
  };
}
