import type {
  DeploymentDetail,
  DeploymentRecord,
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

export const fetchDeployments = (workflowId: string) =>
  request<{ data: DeploymentRecord[] }>(`/api/workflows/${workflowId}/deployments`).then((r) => r.data);
export const fetchDeployment = (workflowId: string, deploymentId: string) =>
  request<DeploymentDetail>(`/api/workflows/${workflowId}/deployments/${deploymentId}`);
/** Makes an earlier deployment live again; returns the workflow with its new `deployment`. */
export const rollbackDeployment = (workflowId: string, deploymentId: string) =>
  request<Workflow>(`/api/workflows/${workflowId}/deployments/${deploymentId}/rollback`, { method: "POST" });
/** Replaces the draft with a deployment's graph (needs the current draft version). */
export const restoreDeployment = (workflowId: string, deploymentId: string, version: number) =>
  request<Workflow>(`/api/workflows/${workflowId}/deployments/${deploymentId}/restore`, {
    method: "POST",
    body: JSON.stringify({ version }),
  });

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

export type RunProgress = { type: "node"; nodeId: string } | { type: "step"; step: Run["steps"][number] };

/** Starts a run and reports each node as it starts and finishes; resolves with the stored run. */
export async function startRunLive(
  workflowId: string,
  trigger: Omit<RunTrigger, "source">,
  environment: Environment,
  onProgress: (event: RunProgress) => void,
): Promise<Run> {
  const response = await fetch(`/api/workflows/${workflowId}/runs`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/x-ndjson" },
    body: JSON.stringify({ trigger, environment }),
  });
  if (!response.ok || !response.body) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string; title?: string };
    throw new ApiError(response.status, problem.detail ?? problem.title ?? response.statusText);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line) as RunProgress | { type: "run"; run: Run } | { type: "error"; message: string };
      if (event.type === "run") return event.run;
      if (event.type === "error") throw new ApiError(500, event.message);
      onProgress(event);
    }
  }
  throw new ApiError(500, "the run ended without a result");
}

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

/** Permanently deletes stored runs (one workflow's, or all). */
export const deleteRuns = (workflowId?: string) =>
  request<{ deleted: number }>(`/api/runs${workflowId ? `?workflowId=${encodeURIComponent(workflowId)}` : ""}`, { method: "DELETE" }).then(
    (r) => r.deleted,
  );

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
