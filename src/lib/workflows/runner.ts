import "server-only";

import { executeWorkflow } from "./engine";
import type { Run, RunTrigger, Workflow } from "./schema";
import { insertRun } from "./store";

const ENV_PREFIX = "REQORA_ENV_";

/** Headers never persisted in run history. */
const REDACTED_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key"]);

function redact(headers: Record<string, string> | undefined) {
  if (!headers) return undefined;
  return Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, REDACTED_HEADERS.has(k.toLowerCase()) ? "[redacted]" : v]),
  );
}

/**
 * Executes a workflow and stores the run. `{{env.NAME}}` reads only `REQORA_ENV_NAME`, so workflow
 * authors can't exfiltrate arbitrary server environment variables.
 */
export async function runWorkflow(
  workflow: Workflow,
  trigger: RunTrigger,
  baseUrl: string,
  replayOf?: string,
): Promise<Run> {
  const result = await executeWorkflow(workflow, trigger, {
    fetch,
    env: (name) => process.env[`${ENV_PREFIX}${name}`],
    baseUrl,
  });

  const run: Run = {
    id: `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    trigger: { ...trigger, headers: redact(trigger.headers) },
    ...result,
    ...(replayOf ? { replayOf } : {}),
  };
  insertRun(run);
  return run;
}
