import { ApiError } from "@/lib/workflows/client";
import type { LoadTest, LoadTestSummary } from "./schema";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string; title?: string; issues?: { path: string; message: string }[] };
    const issues = problem.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new ApiError(response.status, [problem.detail ?? problem.title ?? response.statusText, issues].filter(Boolean).join(" — "));
  }
  return (await response.json()) as T;
}

/** Input as the API accepts it (defaults applied server-side). */
export type LoadTestInput = {
  environment: string;
  virtualUsers: number;
  mode: "iterations" | "duration";
  iterations?: number;
  durationSec?: number;
  rampUpSec?: number;
  thinkTimeMs?: number;
  trigger?: { body?: unknown };
  thresholds?: { maxErrorRatePct?: number; p95Ms?: number };
};

export const startLoadTest = (workflowId: string, input: LoadTestInput) =>
  request<LoadTest>(`/api/workflows/${workflowId}/load-tests`, { method: "POST", body: JSON.stringify(input) });

export const fetchLoadTest = (id: string) => request<LoadTest>(`/api/load-tests/${id}`);

export const stopLoadTest = (id: string) => request<LoadTest>(`/api/load-tests/${id}/stop`, { method: "POST" });

export const fetchLoadTests = (workflowId: string) =>
  request<{ data: LoadTestSummary[] }>(`/api/workflows/${workflowId}/load-tests`).then((r) => r.data);
