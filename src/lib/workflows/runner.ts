import "server-only";

import { checkConditionScript } from "@/lib/collections/condition-script";
import { sendLinkedRequest } from "@/lib/collections/linked";
import { runNodeScript } from "@/lib/collections/node-script";
import { outboundFetch } from "@/lib/net/outbound";
import { resolveVariable, setVariableValue } from "@/lib/secrets/variables";
import { executeWorkflow, type ExecutionResult, type ProgressEvent } from "./engine";
import { MAX_CALL_DEPTH, type Environment, type Run, type RunCaller, type RunTrigger, type Workflow } from "./schema";
import { getDeployedWorkflow, getWorkflow, insertRun } from "./store";

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
  /** Set for a run started by another flow's Call Flow node. */
  calledBy?: RunCaller;
  /** Ids of the flows that called this one, outermost first (loop and depth checks). */
  callers?: string[];
};

type ExecuteOptions = {
  baseUrl: string;
  environment: Environment;
  /** Live step progress. */
  onProgress?: (event: ProgressEvent) => void;
  /** Network override (tests). */
  fetch?: typeof fetch;
  /** Ids of the flows that called this one, outermost first (loop and depth checks). */
  callers?: string[];
  /**
   * The run being executed, when it is stored: flows it calls are stored as runs of their own, linked to it.
   * Without it (load tests) called flows run without being stored.
   */
  runId?: string;
};

/** What a Call Flow node outputs: {{call-1.body.x}}, {{call-1.status}}, {{call-1.runId}}… */
export type CallOutput = {
  runId?: string;
  workflowId: string;
  workflowName: string;
  version: number;
  /** True when the called flow's deployed version ran; false when its draft ran (never deployed). */
  live: boolean;
  /** The called flow's Response node status and body (null without a Response node). */
  status: number | null;
  body: unknown;
};

/**
 * Executes a workflow without storing anything. `{{env.NAME}}` resolves from the environment's stored variables,
 * then falls back to the server variable `REQORA_ENV_NAME` — never arbitrary server env. Returns the result with
 * real values plus every resolved value of 6+ characters (`secrets`), for callers that hand results to someone
 * outside the app. Http nodes linked to a Collections request send it exactly like Send in Collections.
 */
async function execute(
  workflow: Pick<Workflow, "id" | "workspaceId" | "nodes" | "edges">,
  trigger: RunTrigger,
  { baseUrl, environment, onProgress, fetch: doFetch = outboundFetch(baseUrl), callers = [], runId }: ExecuteOptions,
): Promise<{ result: ExecutionResult; secrets: string[] }> {
  const resolved = new Set<string>();
  // rq.variables set by one linked request's scripts are visible to the next ones in this run.
  const variables: Record<string, string> = {};
  const env = (name: string) => {
    const value = resolveVariable(workflow.workspaceId, environment, name) ?? process.env[`${ENV_PREFIX}${name}`];
    // Short values (e.g. "1", "true") would scrub unrelated text; only treat longer ones as sensitive.
    if (value !== undefined && value.length >= 6) resolved.add(value);
    return value;
  };
  const result = await executeWorkflow(workflow, trigger, {
    fetch: doFetch,
    env,
    checkCondition: (code, output) => checkConditionScript(code, output, { readEnv: env, variables }),
    runScript: async (code, context) => {
      const ran = await runNodeScript(code, context, { readEnv: env, variables });
      // rq.environment.set / unset are saved to the run's environment, like Send in Collections.
      for (const [name, value] of Object.entries(ran.environment)) {
        try {
          const { kind } = setVariableValue(workflow.workspaceId, environment, name, value);
          if (kind === "secret" && value !== null && value.length >= 6) resolved.add(value);
        } catch (error) {
          return { error: `could not save environment variable "${name}": ${(error as Error).message}`, logs: ran.logs };
        }
      }
      return ran;
    },
    baseUrl,
    sendLinked: (requestId, context) =>
      sendLinkedRequest(requestId, { workspaceId: workflow.workspaceId, environment, baseUrl, variables, context, fetch: doFetch }),
    callFlow: async (workflowId, body, nodeId) => {
      const chain = [...callers, workflow.id];
      if (chain.includes(workflowId)) {
        const names = [...chain, workflowId].map((id) => `“${getWorkflow(id)?.name ?? id}”`);
        return { ok: false, error: `flows call each other in a loop: ${names.join(" → ")}` };
      }
      if (chain.length > MAX_CALL_DEPTH) return { ok: false, error: `flows can call flows at most ${MAX_CALL_DEPTH} levels deep` };
      const deployed = getDeployedWorkflow(workflowId);
      const target = deployed ?? getWorkflow(workflowId);
      if (!target) return { ok: false, error: "the called flow was deleted" };
      if (target.workspaceId !== workflow.workspaceId) return { ok: false, error: "the called flow is in another workspace" };

      const child: RunTrigger = { source: "flow", body };
      let called: ExecutionResult & { id?: string };
      let childSecrets: string[];
      if (runId) {
        const stored = await runWorkflow(target, child, {
          baseUrl,
          environment,
          calledBy: { runId, workflowId: workflow.id, nodeId },
          callers: chain,
        });
        called = stored.run;
        childSecrets = stored.secrets;
      } else {
        ({ result: called, secrets: childSecrets } = await execute(target, child, { baseUrl, environment, fetch: doFetch, callers: chain }));
      }
      for (const secret of childSecrets) resolved.add(secret);

      const output: CallOutput = {
        ...(called.id ? { runId: called.id } : {}),
        workflowId: target.id,
        workflowName: target.name,
        version: target.version,
        live: Boolean(deployed),
        status: called.output?.status ?? null,
        body: called.output?.body ?? null,
      };
      if (called.status === "succeeded") return { ok: true, output };
      return { ok: false, error: `flow “${target.name}” failed: ${called.error ?? "unknown error"}`, output };
    },
    onProgress,
  });
  return { result, secrets: [...resolved] };
}

/** Executes a workflow (see `execute`) with every resolved secret scrubbed from the result (load tests). */
export async function executeScrubbed(
  workflow: Pick<Workflow, "id" | "workspaceId" | "nodes" | "edges">,
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
  { baseUrl, environment, replayOf, onProgress, calledBy, callers }: RunOptions,
): Promise<{ run: Run; secrets: string[] }> {
  // The id comes first so flows this run calls can point back at it.
  const id = `run_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const { result, secrets } = await execute(workflow, trigger, { baseUrl, environment, onProgress, callers, runId: id });
  const run: Run = {
    id,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    environment,
    trigger: { ...trigger, headers: redact(trigger.headers) },
    ...result,
    ...(replayOf ? { replayOf } : {}),
    ...(calledBy ? { calledBy } : {}),
  };
  insertRun(run);
  return { run, secrets };
}
