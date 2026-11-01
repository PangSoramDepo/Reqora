import type { Run, RunTrigger, Workflow } from "./schema";

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

export async function fetchLatestRun(workflowId: string): Promise<Run | undefined> {
  const { data } = await request<{ data: Run[] }>(`/api/workflows/${workflowId}/runs?limit=1`);
  return data[0];
}
