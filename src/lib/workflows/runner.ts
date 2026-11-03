import "server-only";

import { resolveVariable } from "@/lib/secrets/variables";
import { executeWorkflow } from "./engine";
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

type RunOptions = { baseUrl: string; environment: Environment; replayOf?: string };

/**
 * Executes a workflow and stores the run. `{{env.NAME}}` resolves from the environment's stored
 * variables, then falls back to the server variable `REQORA_ENV_NAME` — never arbitrary server env.
 * Every resolved value is scrubbed from the stored run, even if an upstream echoes it back.
 */
export async function runWorkflow(
  workflow: Workflow,
  trigger: RunTrigger,
  { baseUrl, environment, replayOf }: RunOptions,
): Promise<Run> {
  const resolved = new Set<string>();
  const result = await executeWorkflow(workflow, trigger, {
    fetch,
    env: (name) => {
      const value = resolveVariable(environment, name) ?? process.env[`${ENV_PREFIX}${name}`];
      // Short values (e.g. "1", "true") would scrub unrelated text; only treat longer ones as sensitive.
      if (value !== undefined && value.length >= 6) resolved.add(value);
      return value;
    },
    baseUrl,
  });

  const run: Run = {
    id: `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    environment,
    trigger: { ...trigger, headers: redact(trigger.headers) },
    ...scrub(result, [...resolved]),
    ...(replayOf ? { replayOf } : {}),
  };
  insertRun(run);
  return run;
}
