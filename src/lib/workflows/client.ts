import type {
  Environment,
  Run,
  RunTrigger,
  RunWindow,
  Variable,
  VariableReference,
  Workflow,
  WorkflowInput,
  WorkflowSummary,
} from "./schema";

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

export const createWorkflow = (input: WorkflowInput) =>
  request<Workflow>("/api/workflows", { method: "POST", body: JSON.stringify(input) });

export async function deleteWorkflow(id: string) {
  const response = await fetch(`/api/workflows/${id}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404) throw new ApiError(response.status, response.statusText);
}

export const deployWorkflow = (id: string, version: number) =>
  request<Workflow>(`/api/workflows/${id}/deploy`, { method: "POST", body: JSON.stringify({ version }) });

export type VariableWithUsage = Variable & { usage: VariableReference[] };
export type VariablesResponse = {
  environment: Environment;
  data: VariableWithUsage[];
  missing: { name: string; usage: VariableReference[]; fromServerEnv: boolean }[];
};

export const fetchVariables = (environment: Environment) =>
  request<VariablesResponse>(`/api/environments/${environment}/variables`);

export const putVariable = (
  environment: Environment,
  name: string,
  input: { kind: Variable["kind"]; value: string; description?: string },
) =>
  request<Variable>(`/api/environments/${environment}/variables/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });

export async function deleteVariable(environment: Environment, name: string) {
  const response = await fetch(`/api/environments/${environment}/variables/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!response.ok && response.status !== 404) throw new ApiError(response.status, response.statusText);
}

export function saveWorkflow(workflow: Workflow) {
  const { id, name, description, nodes, edges, version } = workflow;
  return request<Workflow>(`/api/workflows/${id}`, {
    method: "PUT",
    body: JSON.stringify({ name, description, nodes, edges, version }),
  });
}

export const startRun = (workflowId: string, trigger: Omit<RunTrigger, "source">, environment: Environment) =>
  request<Run>(`/api/workflows/${workflowId}/runs`, { method: "POST", body: JSON.stringify({ trigger, environment }) });

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

/** Newest runs for one workflow, or across all workflows (last 30 days) when no id is given. */
export function fetchRecentRuns(workflowId: string | undefined, limit = 25): Promise<Run[]> {
  const url = workflowId
    ? `/api/workflows/${encodeURIComponent(workflowId)}/runs?limit=${limit}`
    : `/api/runs?since=30d&limit=${limit}`;
  return request<{ data: Run[] }>(url).then((r) => r.data);
}
