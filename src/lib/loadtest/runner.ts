import "server-only";

import { outboundFetch } from "@/lib/net/outbound";
import { executeScrubbed } from "@/lib/workflows/runner";
import type { Workflow } from "@/lib/workflows/schema";
import { LoadMetrics, verdictOf } from "./metrics";
import type { LoadTest, LoadTestConfig } from "./schema";
import { getStoredLoadTest, listStoredLoadTests, saveLoadTest } from "./store";

/** Tests running at once on this server (each can have up to 200 virtual users). */
export const MAX_RUNNING = 3;
const PERSIST_EVERY_MS = 5_000;

type Job = {
  base: Omit<LoadTest, keyof ReturnType<LoadMetrics["snapshot"]> | "status" | "verdict" | "finishedAt">;
  metrics: LoadMetrics;
  stop: AbortController;
  done: Promise<LoadTest>;
};

// Survives dev-server module reloads; a server restart ends running tests (they are marked "interrupted").
const jobs: Map<string, Job> = ((globalThis as { __reqoraLoadTests?: Map<string, Job> }).__reqoraLoadTests ??= new Map());

const report = (job: Job, now = Date.now()): LoadTest => ({
  ...job.base,
  status: "running",
  ...job.metrics.snapshot(now),
});

/** Resolves after `ms`, or early when the signal aborts. */
function pause(ms: number, signal: AbortSignal) {
  if (ms <= 0 || signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export type StartResult = { ok: true; test: LoadTest } | { ok: false; reason: "busy" };

/**
 * Starts a load test in the background: `virtualUsers` concurrent loops, each running the flow back to back
 * (with think time) until the iteration budget or the duration is used up. Runs are not stored in Execution
 * History; the aggregated report is (see GET /api/load-tests/{id}). `fetch` is for tests.
 */
export function startLoadTest(
  workflow: Workflow,
  config: LoadTestConfig,
  { baseUrl, fetch: doFetch = outboundFetch(baseUrl) }: { baseUrl: string; fetch?: typeof fetch },
): StartResult {
  if (runningCount() >= MAX_RUNNING) return { ok: false, reason: "busy" };

  const startMs = Date.now();
  const stop = new AbortController();
  const metrics = new LoadMetrics(startMs);
  const id = `lt_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const base: Job["base"] = {
    id,
    workflowId: workflow.id,
    workflowName: workflow.name,
    workflowVersion: workflow.version,
    environment: config.environment,
    config,
    startedAt: new Date(startMs).toISOString(),
  };

  // Stopping also cancels requests in flight; those runs are left out of the report.
  const fetchWithStop: typeof fetch = (input, init) =>
    doFetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, stop.signal]) : stop.signal });

  const deadline = config.mode === "duration" ? startMs + config.durationSec * 1000 : Infinity;
  let issued = 0;
  const nextIteration = () => {
    if (stop.signal.aborted) return false;
    if (config.mode === "iterations") return issued < config.iterations ? (issued += 1) > 0 : false;
    return Date.now() < deadline;
  };

  const virtualUser = async (index: number) => {
    await pause((config.rampUpSec * 1000 * index) / config.virtualUsers, stop.signal);
    if (!nextIteration()) return;
    metrics.setActive(1, Date.now());
    try {
      do {
        const result = await executeScrubbed(workflow, { source: "manual", ...config.trigger }, {
          baseUrl,
          environment: config.environment,
          fetch: fetchWithStop,
        }).catch((error: Error) => ({ status: "failed" as const, durationMs: 0, steps: [], error: error.message }));
        if (stop.signal.aborted) break;
        metrics.record(result, Date.now());
        await pause(config.thinkTimeMs, stop.signal);
      } while (nextIteration());
    } finally {
      metrics.setActive(-1, Date.now());
    }
  };

  const job: Job = { base, metrics, stop, done: Promise.resolve(undefined as unknown as LoadTest) };
  jobs.set(id, job);
  saveLoadTest(report(job, startMs));

  const persist = setInterval(() => saveLoadTest(report(job)), PERSIST_EVERY_MS);
  job.done = Promise.all(Array.from({ length: config.virtualUsers }, (_, i) => virtualUser(i)))
    .then(() => {
      const snapshot = report(job);
      const verdict = verdictOf(config.thresholds, snapshot);
      const final: LoadTest = {
        ...snapshot,
        status: stop.signal.aborted ? "stopped" : "completed",
        ...(verdict ? { verdict } : {}),
        finishedAt: new Date().toISOString(),
      };
      saveLoadTest(final);
      return final;
    })
    .finally(() => {
      clearInterval(persist);
      jobs.delete(id);
    });

  return { ok: true, test: report(job, startMs) };
}

export const runningCount = () => jobs.size;

/** Live report while running, else the stored one; a "running" row without a live job was cut short by a restart. */
export function getLoadTest(id: string): LoadTest | undefined {
  const job = jobs.get(id);
  if (job) return report(job);
  const stored = getStoredLoadTest(id);
  if (stored?.status === "running") {
    const interrupted: LoadTest = { ...stored, status: "interrupted", activeVirtualUsers: 0 };
    saveLoadTest(interrupted);
    return interrupted;
  }
  return stored;
}

export function listLoadTests(workflowId: string, limit = 20): LoadTest[] {
  return listStoredLoadTests(workflowId, limit).map((t) => (t.status === "running" ? (getLoadTest(t.id) ?? t) : t));
}

/** Asks a running test to stop; resolves with its final report (undefined if it isn't running). */
export async function stopLoadTest(id: string): Promise<LoadTest | undefined> {
  const job = jobs.get(id);
  if (!job) return undefined;
  job.stop.abort();
  return job.done;
}

/** Waits for a running test to finish (tests). */
export const waitForLoadTest = (id: string) => jobs.get(id)?.done;
