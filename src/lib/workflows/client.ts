import type { Run, RunTrigger, RunWindow, Workflow, WorkflowSummary } from "./schema";

/** Error carrying the API's problem+json details. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string; title?: string; issues?: { path: string; message: string }[] };
    const issues = problem.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new ApiError(response.status, [problem.detail ?? problem.title ?? response.statusText, issues].filter(Boolean).join(" — "));
  }
  return (await response.json()) as T;
}

export const fetchWorkflow = (id: string) => request<Workflow>(`/api/workflows/${id}`);

export function saveWorkflow(workflow: Workflow) {
  const { id, name, description, nodes, edges, version } = workflow;
  return request<Workflow>(`/api/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, description, nodes, edges, version }),
  });
}

export const startRun = (workflowId: string, trigger: Omit<RunTrigger, "source">) =>
  request<Run>(`/api/workflows/${workflowId}/runs`, { method: "POST", body: JSON.stringify({ trigger }) });

export type RunStatsResponse = {
  window: RunWindow;
  since: string;
  total: number;
  succeeded: number;
  failed: number;
  successRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
};

export const fetchRuns = (since: RunWindow, status?: Run["status"]) =>
  request<{ data: Run[] }>(`/api/runs?since=${since}&limit=100${status ? `&status=${status}` : ""}`).then((r) => r.data);

export const fetchRunStats = (since: RunWindow) => request<RunStatsResponse>(`/api/runs/stats?since=${since}`);

export const replayRun = (runId: string) => request<Run>(`/api/runs/${runId}/replay`, { method: "POST" });

export const fetchWorkflowSummaries = () =>
  request<{ data: WorkflowSummary[] }>("/api/workflows").then((r) => r.data);

export async function fetchLatestRun(workflowId: string): Promise<Run | undefined> {
  const { data } = await request<{ data: Run[] }>(`/api/workflows/${workflowId}/runs?limit=1`);
  return data[0];
}
