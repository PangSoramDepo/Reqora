import { z } from "zod";
import { environmentSchema, type Environment, type NodeType } from "@/lib/workflows/schema";

// Keep in sync with api/openapi.yaml.

export const LOAD_LIMITS = {
  virtualUsers: 200,
  iterations: 100_000,
  durationSec: 1800,
  rampUpSec: 600,
  thinkTimeMs: 60_000,
} as const;

export const loadTestConfigSchema = z
  .object({
    environment: environmentSchema.default("sandbox"),
    /** Concurrent virtual users: each runs the flow back to back. */
    virtualUsers: z.number().int().min(1).max(LOAD_LIMITS.virtualUsers),
    /** Stop after a total number of iterations, or after a duration. */
    mode: z.enum(["iterations", "duration"]).default("iterations"),
    /** Total flow runs across all virtual users (mode "iterations"). */
    iterations: z.number().int().min(1).max(LOAD_LIMITS.iterations).default(100),
    /** How long to keep starting runs (mode "duration"); runs in flight at the end still finish. */
    durationSec: z.number().int().min(1).max(LOAD_LIMITS.durationSec).default(60),
    /** Virtual users start evenly spread over this time. */
    rampUpSec: z.number().int().min(0).max(LOAD_LIMITS.rampUpSec).default(0),
    /** Pause between one virtual user's runs. */
    thinkTimeMs: z.number().int().min(0).max(LOAD_LIMITS.thinkTimeMs).default(0),
    /** Webhook payload every run receives. */
    trigger: z
      .object({ body: z.unknown().optional(), headers: z.record(z.string(), z.string()).optional() })
      .default({}),
    /** The test fails when any threshold is exceeded. */
    thresholds: z
      .object({
        maxErrorRatePct: z.number().min(0).max(100).optional(),
        p95Ms: z.number().int().min(1).max(600_000).optional(),
      })
      .default({}),
  })
  .refine((c) => c.mode !== "iterations" || c.iterations >= c.virtualUsers, {
    message: "iterations must be at least the number of virtual users",
    path: ["iterations"],
  });
export type LoadTestConfig = z.infer<typeof loadTestConfigSchema>;

export type LatencyStats = { min: number; avg: number; p50: number; p90: number; p95: number; p99: number; max: number };

export type LoadTestStatus = "running" | "completed" | "stopped" | "interrupted";

export type LoadTest = {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: number;
  environment: Environment;
  config: LoadTestConfig;
  status: LoadTestStatus;
  /** Set when thresholds were configured and the test ended. */
  verdict?: { passed: boolean; reasons: string[] };
  startedAt: string;
  finishedAt?: string;
  elapsedMs: number;
  activeVirtualUsers: number;
  iterations: { completed: number; succeeded: number; failed: number };
  /** Completed iterations per second over the whole test. */
  throughput: number;
  errorRatePct: number;
  /** End-to-end flow run duration. */
  latency: LatencyStats | null;
  /** Per executed node (skipped steps excluded). */
  nodes: { nodeId: string; name: string; type: NodeType; calls: number; failed: number; latency: LatencyStats | null }[];
  /** One point per second since the start. */
  timeline: { second: number; succeeded: number; failed: number; p95Ms: number | null; activeVirtualUsers: number }[];
  /** Most frequent failure messages. */
  errors: { message: string; count: number }[];
};

export type LoadTestSummary = Pick<
  LoadTest,
  "id" | "workflowId" | "status" | "verdict" | "startedAt" | "finishedAt" | "elapsedMs" | "iterations" | "throughput" | "errorRatePct" | "environment"
> & { virtualUsers: number; p95Ms: number | null };

export const toSummary = (t: LoadTest): LoadTestSummary => ({
  id: t.id,
  workflowId: t.workflowId,
  status: t.status,
  ...(t.verdict ? { verdict: t.verdict } : {}),
  startedAt: t.startedAt,
  ...(t.finishedAt ? { finishedAt: t.finishedAt } : {}),
  elapsedMs: t.elapsedMs,
  iterations: t.iterations,
  throughput: t.throughput,
  errorRatePct: t.errorRatePct,
  environment: t.environment,
  virtualUsers: t.config.virtualUsers,
  p95Ms: t.latency?.p95 ?? null,
});
