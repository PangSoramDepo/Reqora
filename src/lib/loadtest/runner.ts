import "server-only";

import { outboundFetch } from "@/lib/net/outbound";
import { DEFAULT_ROLE, flowRoles, type TestUser } from "@/lib/users/schema";
import { findTestUser, listTestUsers, usersWithRole } from "@/lib/users/store";
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

export type StartResult = { ok: true; test: LoadTest } | { ok: false; reason: "busy" } | { ok: false; reason: "unknown_users"; detail: string };

/**
 * The test users each of the flow's roles uses: the ones listed in the config, else every user with that role
 * tag (every user, for a flow that names no roles). Roles nobody plays are left out (their steps fail with why).
 */
export function userPools(
  workflow: Pick<Workflow, "workspaceId" | "roles">,
  config: Pick<LoadTestConfig, "environment" | "users">,
): { pools: Map<string, TestUser[]>; unknown: string[] } {
  const scope = { workspaceId: workflow.workspaceId, environment: config.environment };
  const roles = flowRoles(workflow.roles);
  const pools = new Map<string, TestUser[]>();
  const unknown: string[] = [];
  for (const role of roles) {
    const listed = config.users.roles[role] ?? [];
    let users: TestUser[];
    if (listed.length) {
      users = listed.flatMap((ref) => {
        const found = findTestUser(scope, ref);
        if (!found) unknown.push(ref);
        return found ? [found] : [];
      });
    } else {
      users = usersWithRole(scope, role);
      if (!users.length && role === DEFAULT_ROLE && roles.length === 1) users = listTestUsers(scope).users;
    }
    if (users.length) pools.set(role, users);
  }
  return { pools, unknown };
}

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
  const { pools, unknown } = userPools(workflow, config);
  if (unknown.length) return { ok: false, reason: "unknown_users", detail: `no test users named ${unknown.map((u) => `"${u}"`).join(", ")} in ${config.environment}` };

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
    ...(pools.size ? { userPools: [...pools].map(([role, users]) => ({ role, users: users.map((u) => u.name) })) } : {}),
  };
  // Who plays each role in a run: per virtual user (fixed), or taking turns run by run.
  let runCounter = 0;
  const assign = (vu: number): { ids: Record<string, string>; names: Record<string, string> } => {
    const turn = runCounter++;
    const ids: Record<string, string> = {};
    const names: Record<string, string> = {};
    for (const [role, users] of pools) {
      const user = users[(config.users.assignment === "per-vu" ? vu : turn) % users.length];
      ids[role] = user.id;
      names[role] = user.name;
    }
    return { ids, names };
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
        const played = assign(index);
        const result = await executeScrubbed(workflow, { source: "manual", ...config.trigger }, {
          baseUrl,
          environment: config.environment,
          fetch: fetchWithStop,
          users: played.ids,
        }).catch((error: Error) => ({ status: "failed" as const, durationMs: 0, steps: [], error: error.message }));
        if (stop.signal.aborted) break;
        metrics.record(result, Date.now());
        metrics.recordUsers(played.names, result.status === "succeeded", result.durationMs);
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
