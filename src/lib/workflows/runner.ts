import "server-only";

import { checkConditionScript } from "@/lib/collections/condition-script";
import { sendLinkedRequest } from "@/lib/collections/linked";
import { outboundFetch } from "@/lib/net/outbound";
import { resolveVariable } from "@/lib/secrets/variables";
import { executeWorkflow, type ExecutionResult, type ProgressEvent } from "./engine";
import type { Environment, Run, RunTrigger, Workflow } from "./schema";
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

/** Replaces every occurrence of the given secret values inside strings, recursively. */
export function scrub<T>(value: T, secrets: string[]): T {
  if (secrets.length === 0) return value;
  if (typeof value === "string") {
    return secrets.reduce<string>((s, secret) => s.split(secret).join("[secret]"), value) as T;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, secrets)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, secrets)])) as T;
  }
  return value;
}

type RunOptions = {
  baseUrl: string;
  environment: Environment;
  replayOf?: string;
  /** Live step progress, e.g. to animate the canvas while the run executes. */
  onProgress?: (event: ProgressEvent) => void;
};

type ExecuteOptions = {
  baseUrl: string;
  environment: Environment;
  /** Live step progress. */
  onProgress?: (event: ProgressEvent) => void;
  /** Network override (tests). */
  fetch?: typeof fetch;
};

/**
 * Executes a workflow without storing anything. `{{env.NAME}}` resolves from the environment's stored variables,
 * then falls back to the server variable `REQORA_ENV_NAME` — never arbitrary server env. Returns the result with
 * real values plus every resolved value of 6+ characters (`secrets`), for callers that hand results to someone
 * outside the app. Http nodes linked to a Collections request send it exactly like Send in Collections.
 */
async function execute(
  workflow: Pick<Workflow, "nodes" | "edges">,
  trigger: RunTrigger,
  { baseUrl, environment, onProgress, fetch: doFetch = outboundFetch(baseUrl) }: ExecuteOptions,
): Promise<{ result: ExecutionResult; secrets: string[] }> {
  const resolved = new Set<string>();
  // rq.variables set by one linked request's scripts are visible to the next ones in this run.
  const variables: Record<string, string> = {};
  const env = (name: string) => {
    const value = resolveVariable(environment, name) ?? process.env[`${ENV_PREFIX}${name}`];
    // Short values (e.g. "1", "true") would scrub unrelated text; only treat longer ones as sensitive.
    if (value !== undefined && value.length >= 6) resolved.add(value);
    return value;
  };
  const result = await executeWorkflow(workflow, trigger, {
    fetch: doFetch,
    env,
    checkCondition: (code, output) => checkConditionScript(code, output, { readEnv: env, variables }),
    baseUrl,
    sendLinked: (requestId, context) =>
      sendLinkedRequest(requestId, { environment, baseUrl, variables, context, fetch: doFetch }),
    onProgress,
  });
  return { result, secrets: [...resolved] };
}

/** Executes a workflow (see `execute`) with every resolved secret scrubbed from the result (load tests). */
export async function executeScrubbed(
  workflow: Pick<Workflow, "nodes" | "edges">,
  trigger: RunTrigger,
  options: ExecuteOptions,
): Promise<ExecutionResult> {
  const { result, secrets } = await execute(workflow, trigger, options);
  return scrub(result, secrets);
}

/**
 * Executes a workflow and stores the run in Execution History with real values (like the Collections send
 * history), so requests and outputs can be inspected. `secrets` lists the resolved values to scrub from anything
 * that leaves the app (a deployed webhook's response). Incoming trigger headers stay redacted.
 */
export async function runWorkflow(
  workflow: Workflow,
  trigger: RunTrigger,
  { baseUrl, environment, replayOf, onProgress }: RunOptions,
): Promise<{ run: Run; secrets: string[] }> {
  const { result, secrets } = await execute(workflow, trigger, { baseUrl, environment, onProgress });
  const run: Run = {
    id: `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    environment,
    trigger: { ...trigger, headers: redact(trigger.headers) },
    ...result,
    ...(replayOf ? { replayOf } : {}),
  };
  insertRun(run);
  return { run, secrets };
}
