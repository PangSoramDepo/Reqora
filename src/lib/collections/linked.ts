import "server-only";

import { capStepBody, type Environment, type StepRequest, type Workflow, type WorkflowNode } from "@/lib/workflows/schema";
import type { UserHandle } from "@/lib/users/schema";
import type { TemplateContext } from "@/lib/workflows/template";
import type { SendOutcome } from "./schema";
import type { ScriptDebug } from "./script-debug";
import { describeAssertion } from "./assertions";
import { resolveEffective } from "./inherit";
import { sendRequest } from "./send";
import { getRequest, requestScopes, requestWorkspace } from "./store";
import { requestToHttpConfig } from "./to-node";

type HttpConfig = Extract<WorkflowNode, { type: "http" }>["config"];

const DELETED = "the linked Collections request was deleted — unlink the node to keep its last copy";
const ELSEWHERE = "the linked Collections request is in another workspace — unlink the node to keep its last copy";

/**
 * The http node config for a saved request as it is right now, with its collection/folder auth and headers
 * applied. Workflow nodes dropped from Collections keep `requestId` and are rebuilt from this on every run.
 */
export function linkedHttpConfig(requestId: string, workspaceId: string): { ok: true; config: HttpConfig } | { ok: false; error: string } {
  const saved = getRequest(requestId);
  if (!saved) {
    return { ok: false, error: DELETED };
  }
  if (requestWorkspace(requestId) !== workspaceId) return { ok: false, error: ELSEWHERE };
  const scopes = requestScopes(saved.collectionId, saved.folderId);
  const effective = resolveEffective({ name: saved.name, definition: saved.definition }, scopes.collection, scopes.folders);
  const converted = requestToHttpConfig(saved.name, saved.definition, effective, { linked: true });
  if (!converted.ok) return { ok: false, error: `the linked request “${saved.name}” can't run in a workflow: ${converted.error}` };
  return { ok: true, config: { ...converted.draft.config, requestId } };
}


export type LinkedStep = {
  ok: boolean;
  error?: string;
  request?: StepRequest;
  /** Debug runs: the request's scripts' recorded runs. */
  debug?: ScriptDebug[];
  output?: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    durationMs: number;
    tests?: { name: string; passed: boolean; error?: string }[];
    logs?: string[];
  };
};

/**
 * Runs a linked node exactly like Send in Collections: collection → folder → request auth, headers, pre-request
 * scripts, assertions and post-response scripts, with `rq.environment.set` saved. `variables` is the run's shared
 * `rq.variables` bag (updated in place), and `context` lets templates use `{{trigger.*}}` and earlier nodes.
 * The step fails on a script error, a failed test, or a status of 400 or more.
 */
export async function sendLinkedRequest(
  requestId: string,
  options: {
    /** The running flow's workspace: the request must be in it. */
    workspaceId: string;
    environment: Environment;
    baseUrl: string;
    variables: Record<string, string>;
    context: Pick<TemplateContext, "trigger" | "nodes">;
    fetch?: typeof fetch;
    /** The test user the step acts as. */
    user?: UserHandle;
    /** Record the request's scripts' runs for stepping through. */
    debug?: boolean;
  },
): Promise<LinkedStep> {
  const saved = getRequest(requestId);
  if (!saved) return { ok: false, error: DELETED };
  if (requestWorkspace(requestId) !== options.workspaceId) return { ok: false, error: ELSEWHERE };
  const scopes = requestScopes(saved.collectionId, saved.folderId);
  // Runs keep real values (like the Collections send history), so take the outcome before it's scrubbed — that
  // also keeps real values in the rq.variables handed to the next linked request.
  let raw: SendOutcome | undefined;
  const scrubbed = await sendRequest(
    { name: saved.name, definition: saved.definition, collection: scopes.collection, folders: scopes.folders },
    {
      workspaceId: options.workspaceId,
      environment: options.environment,
      baseUrl: options.baseUrl,
      variables: options.variables,
      context: options.context,
      ...(options.user ? { user: options.user } : {}),
      ...(options.debug ? { debug: true } : {}),
      onUnscrubbed: (outcome) => {
        raw = outcome;
      },
      ...(options.fetch ? { fetch: options.fetch } : {}),
    },
  );
  const outcome = raw ?? scrubbed;
  Object.assign(options.variables, outcome.scripts?.variables);

  const sent = outcome.request;
  const request: StepRequest | undefined = sent && {
    method: sent.method,
    url: sent.url,
    headers: sent.headers,
    ...(sent.body !== undefined ? { body: capStepBody(sent.body) } : {}),
    ...(sent.form ? { form: sent.form } : {}),
    ...(sent.file ? { file: sent.file } : {}),
  };
  const debug = outcome.scripts?.debug?.length ? { debug: outcome.scripts.debug } : {};
  if ("error" in outcome) return { ok: false, error: outcome.error, request, ...debug };

  const tests = [
    ...outcome.assertions.map((a) => ({ name: describeAssertion(a.assertion), passed: a.passed, ...(a.passed ? {} : { error: `got ${a.actual ?? "nothing"}` }) })),
    ...outcome.scripts.tests.map((t) => ({ name: t.name, passed: t.passed, ...(t.error ? { error: t.error } : {}) })),
  ];
  const logs = outcome.scripts.logs.map((l) => (l.level === "log" ? l.message : `[${l.level}] ${l.message}`));
  const output = {
    status: outcome.status,
    headers: outcome.headers,
    body: outcome.body,
    durationMs: outcome.durationMs,
    ...(tests.length ? { tests } : {}),
    ...(logs.length ? { logs } : {}),
  };

  const scriptError = outcome.scripts.errors[0];
  const failed = tests.filter((t) => !t.passed);
  const error = scriptError
    ? `${scriptError.phase === "pre" ? "pre-request" : "post-response"} script (${scriptError.scope} “${scriptError.source}”) failed: ${scriptError.message}`
    : failed.length
      ? `${failed.length} test${failed.length === 1 ? "" : "s"} failed: ${failed.map((t) => t.name).join(", ")}`
      : outcome.status >= 400
        ? `upstream responded ${outcome.status}`
        : undefined;
  return error ? { ok: false, error, request, output, ...debug } : { ok: true, request, output, ...debug };
}

/**
 * Refreshes the stored copy on every linked http node, so the canvas (and a deployed snapshot) shows the
 * request as it is now. Nodes whose request is gone or unconvertible keep their last copy.
 */
export function syncLinkedNodes<T extends Pick<Workflow, "nodes" | "workspaceId">>(workflow: T): T {
  if (!workflow.nodes.some((n) => n.type === "http" && n.config.requestId)) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.type !== "http" || !node.config.requestId) return node;
      const linked = linkedHttpConfig(node.config.requestId, workflow.workspaceId);
      // Flow-only settings (repeat until) aren't part of the saved request, so they're kept.
      return linked.ok ? { ...node, config: { ...linked.config, ...(node.config.repeat ? { repeat: node.config.repeat } : {}) } } : node;
    }),
  };
}
