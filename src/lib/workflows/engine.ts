import { DEFAULT_USER_AGENT } from "@/lib/user-agent";
import { topologicalOrder } from "./graph";
import type { UserHandle } from "@/lib/users/schema";
import { capStepBody, type RepeatCheck, type RunStatus, type RunTrigger, type Step, type StepRequest, type Workflow, type WorkflowNode } from "./schema";
import type { ScriptDebug } from "@/lib/collections/script-debug";
import { TemplateError, looseEquals, renderJson, renderString, renderValue, type TemplateContext } from "./template";

const MAX_RESPONSE_BYTES = 1_000_000;

type HttpConfig = Extract<WorkflowNode, { type: "http" }>["config"];

export type LinkedResult = { ok: boolean; error?: string; request?: Step["request"]; output?: unknown; debug?: ScriptDebug[] };
export type ProgressEvent =
  | { type: "node"; nodeId: string }
  | { type: "step"; step: Step }
  /** A "repeat until" node's condition wasn't met yet; it sends again after `waitMs`. */
  | { type: "attempt"; nodeId: string; attempt: number; maxAttempts: number; waitMs: number; logs?: string[] };

/** Most recent "repeat until" checks kept on a step. */
const MAX_CHECKS = 20;
const SCRIPTS_UNAVAILABLE = '"repeat until" scripts are not available here';
type ConditionCheck = ({ met: true } | { met: false } | { error: string }) & { logs?: string[]; debug?: ScriptDebug[] };
type ScriptRun = ({ output: unknown } | { error: string }) & { logs?: string[]; debug?: ScriptDebug[] };

export type EngineDeps = {
  fetch: typeof fetch;
  /** Returns the variable's value, or undefined when it is not configured. */
  env: (name: string) => string | undefined;
  /** Origin that relative HTTP node URLs resolve against. */
  baseUrl: string;
  /**
   * Sends a linked http node's saved Collections request (with its scripts and tests). When omitted, linked
   * nodes send their stored copy like any other http node.
   */
  sendLinked?: (requestId: string, ctx: Pick<TemplateContext, "trigger" | "nodes">, user?: UserHandle) => Promise<LinkedResult>;
  /**
   * Evaluates a "repeat until" script condition against a node's response (the script sandbox). When omitted,
   * script conditions fail the step.
   */
  checkCondition?: (code: string, output: unknown, user?: UserHandle) => Promise<ConditionCheck>;
  /**
   * Runs a Script node's code in the script sandbox with the run so far (`trigger`, earlier `nodes`). When
   * omitted, script nodes fail the step.
   */
  runScript?: (code: string, context: { trigger: unknown; nodes: Record<string, unknown> }, user?: UserHandle) => Promise<ScriptRun>;
  /**
   * The test user a node acts as ({{user.*}}, rq.user), or why there is none. When omitted, no user acts and
   * `{{user.*}}` fails the step.
   */
  userFor?: (node: WorkflowNode) => UserHandle | { missing: string };
  /** Runs before a node that acts as a user executes (e.g. logging the user in); throwing fails the step. */
  beforeNode?: (node: WorkflowNode, user: UserHandle) => Promise<void>;
  /** After a 401, logs the user in again; true = send the request once more. */
  reauth?: (node: WorkflowNode, user: UserHandle) => Promise<boolean>;
  /**
   * Runs another flow for a Call Flow node and waits for it. When omitted, call nodes fail the step.
   * `output` is what later nodes read as {{node-id.*}}.
   */
  callFlow?: (workflowId: string, body: unknown, nodeId: string) => Promise<LinkedResult>;
  /** Live progress: a node is about to run, or a step finished (including skipped ones). */
  onProgress?: (event: ProgressEvent) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type ExecutionResult = {
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: Step[];
  output?: { status: number; body: unknown };
  error?: string;
};

type NodeResult = {
  output?: unknown;
  port?: string;
  request?: Step["request"];
  attempts?: number;
  checks?: RepeatCheck[];
  logs?: string[];
  debug?: ScriptDebug[];
};

class StepError extends Error {
  constructor(
    message: string,
    readonly partial: Omit<NodeResult, "port"> = {},
  ) {
    super(message);
  }
}

export async function executeWorkflow(
  workflow: Pick<Workflow, "nodes" | "edges">,
  trigger: RunTrigger,
  deps: EngineDeps,
): Promise<ExecutionResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const runStart = now();

  const order = topologicalOrder(workflow.nodes, workflow.edges);
  if (!order) throw new Error("workflow graph contains a cycle");

  const ctx: TemplateContext = {
    trigger: { body: trigger.body, headers: trigger.headers },
    nodes: {},
    env: (name) => {
      const value = deps.env(name);
      if (value === undefined) throw new TemplateError(`environment variable "${name}" is not configured`);
      return value;
    },
  };

  // Output port each executed node took; "*" = every port (a disabled node passes the run through).
  const takenPorts = new Map<string, string>();
  const steps: Step[] = [];
  const record = (step: Step) => {
    steps.push(step);
    deps.onProgress?.({ type: "step", step });
  };
  let failure: string | undefined;
  let output: ExecutionResult["output"];

  for (const node of order) {
    const incoming = workflow.edges.filter((e) => e.target === node.id);
    const reached =
      node.type === "webhook" ||
      incoming.some((e) => {
        const taken = takenPorts.get(e.source);
        return taken === e.sourcePort || taken === "*";
      });
    const stepStart = now();
    const base = { nodeId: node.id, nodeType: node.type, name: node.name, startedAt: new Date(stepStart).toISOString() };

    if (failure || !reached) {
      record({ ...base, status: "skipped", durationMs: 0 });
      continue;
    }
    if (node.disabled && node.type !== "webhook") {
      takenPorts.set(node.id, "*");
      record({ ...base, status: "skipped", durationMs: 0, disabled: true });
      continue;
    }

    deps.onProgress?.({ type: "node", nodeId: node.id });
    // The test user this node acts as.
    const acting = deps.userFor?.(node);
    const user = acting && "id" in acting ? acting : undefined;
    ctx.user = user
      ? (name) => {
          const value = user.get(name);
          if (value === undefined) throw new TemplateError(`test user “${user.name}” (${user.role}) has no value for "${name}"`);
          return value;
        }
      : acting && "missing" in acting
        ? () => {
            throw new TemplateError(acting.missing);
          }
        : undefined;
    // Recorded on the steps that act for someone (send or script).
    const actor = user && (node.type === "http" || node.type === "script" || node.type === "call") ? { actor: { role: user.role, user: user.name } } : {};
    try {
      if (user && deps.beforeNode) await deps.beforeNode(node, user);
      const result = await runNode(node, ctx, deps, sleep, user);
      const port = result.port ?? "out";
      ctx.nodes[node.id] = result.output;
      takenPorts.set(node.id, port);
      if (node.type === "response") output = result.output as ExecutionResult["output"];
      record({
        ...base,
        status: "succeeded",
        durationMs: now() - stepStart,
        port: node.type === "response" ? undefined : port,
        ...actor,
        request: result.request,
        output: result.output,
        ...(result.attempts ? { attempts: result.attempts } : {}),
        ...(result.checks?.length ? { checks: result.checks } : {}),
        ...(result.logs?.length ? { logs: result.logs } : {}),
        ...(result.debug?.length ? { debug: result.debug } : {}),
      });
    } catch (error) {
      failure = `${node.name}: ${(error as Error).message}`;
      const partial = error instanceof StepError ? error.partial : {};
      record({ ...base, status: "failed", durationMs: now() - stepStart, ...actor, ...partial, error: (error as Error).message });
    }
  }

  const finished = now();
  return {
    status: failure ? "failed" : "succeeded",
    startedAt: new Date(runStart).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - runStart,
    steps,
    output,
    error: failure,
  };
}

async function runNode(
  node: WorkflowNode,
  ctx: TemplateContext,
  deps: EngineDeps,
  sleep: (ms: number) => Promise<void>,
  user?: UserHandle,
): Promise<NodeResult> {
  switch (node.type) {
    case "webhook":
      return { output: { body: ctx.trigger.body ?? null, headers: ctx.trigger.headers ?? {} } };

    case "http": {
      const sendOnce = async (): Promise<NodeResult> => {
        if (!node.config.requestId || !deps.sendLinked) return runHttp(node.config, ctx, deps);
        const linked = await deps.sendLinked(node.config.requestId, { trigger: ctx.trigger, nodes: ctx.nodes }, user);
        const debug = linked.debug?.length ? { debug: linked.debug } : {};
        if (!linked.ok) throw new StepError(linked.error ?? "linked request failed", { request: linked.request, output: linked.output, ...debug });
        return { output: linked.output, request: linked.request, ...debug };
      };
      // A 401 while acting as a user: log them in again once, then retry (an expired token).
      const send = async (): Promise<NodeResult> => {
        try {
          return await sendOnce();
        } catch (error) {
          const status = error instanceof StepError ? (error.partial.output as { status?: unknown } | undefined)?.status : undefined;
          if (status === 401 && user && deps.reauth && (await deps.reauth(node, user))) return sendOnce();
          throw error;
        }
      };
      const repeat = node.config.repeat;
      if (!repeat) return send();
      const isScript = repeat.mode === "script";
      if (isScript ? !repeat.script?.trim() : !repeat.left.trim()) {
        throw new StepError('"repeat until" has no condition: fill it in, or turn repeating off');
      }
      // One entry per check, so a run shows why it kept waiting (script logs, the value compared, errors).
      const checks: RepeatCheck[] = [];
      // Debug runs: the request's scripts plus the latest condition check's script.
      let checkDebug: ScriptDebug[] = [];
      const done = (partial: NodeResult, attempt: number): NodeResult => {
        const debug = [...(partial.debug ?? []), ...checkDebug];
        return { ...partial, attempts: attempt, checks: checks.slice(-MAX_CHECKS), ...(debug.length ? { debug } : {}) };
      };
      for (let attempt = 1; ; attempt++) {
        let result: NodeResult;
        try {
          result = await send();
        } catch (error) {
          if (error instanceof StepError) Object.assign(error.partial, { attempts: attempt, checks: checks.slice(-MAX_CHECKS) });
          throw error;
        }
        // The condition reads this node's latest response, like a later node would ({{node-id.body.x}}).
        ctx.nodes[node.id] = result.output;
        let met: boolean;
        let unmet: string;
        if (isScript) {
          if (!deps.checkCondition) throw new StepError(SCRIPTS_UNAVAILABLE, done(result, attempt));
          const checked = await deps.checkCondition(repeat.script!, result.output, user);
          checkDebug = checked.debug ?? [];
          const logs = checked.logs?.length ? { logs: checked.logs } : {};
          if ("error" in checked) {
            checks.push({ attempt, met: false, error: checked.error, ...logs });
            throw new StepError(checked.error, done(result, attempt));
          }
          met = checked.met;
          checks.push({ attempt, met, ...logs });
          unmet = "the script returned false";
        } else {
          const left = renderValue(repeat.left, ctx);
          const right = repeat.right === undefined ? undefined : renderValue(repeat.right, ctx);
          met = compare(left, repeat.operator, right);
          checks.push({ attempt, met, logs: [`${repeat.left} = ${JSON.stringify(left) ?? "undefined"}`] });
          const wanted = repeat.operator === "exists" ? "to exist" : `${repeat.operator} ${JSON.stringify(right)}`;
          unmet = `${repeat.left} was ${JSON.stringify(left) ?? "undefined"}, expected ${wanted}`;
        }
        if (met) return done(result, attempt);
        if (attempt >= repeat.maxAttempts) {
          throw new StepError(`condition not met after ${attempt} attempts: ${unmet}`, done(result, attempt));
        }
        const last = checks.at(-1)?.logs;
        deps.onProgress?.({
          type: "attempt",
          nodeId: node.id,
          attempt,
          maxAttempts: repeat.maxAttempts,
          waitMs: repeat.intervalMs,
          ...(last ? { logs: last } : {}),
        });
        await sleep(repeat.intervalMs);
      }
    }

    case "condition": {
      const { left, operator, right } = node.config;
      const result = compare(renderValue(left, ctx), operator, right === undefined ? undefined : renderValue(right, ctx));
      return { output: { result }, port: result ? "true" : "false" };
    }

    case "transform":
      return {
        output: Object.fromEntries(
          Object.entries(node.config.output).map(([key, template]) => [key, renderValue(template, ctx)]),
        ),
      };

    case "delay":
      await sleep(node.config.ms);
      return { output: { delayedMs: node.config.ms } };

    case "script": {
      if (!node.config.code.trim()) throw new StepError("the script is empty");
      if (!deps.runScript) throw new StepError("script nodes are not available here");
      const ran = await deps.runScript(node.config.code, { trigger: ctx.trigger, nodes: { ...ctx.nodes } }, user);
      const logs = { ...(ran.logs?.length ? { logs: ran.logs } : {}), ...(ran.debug?.length ? { debug: ran.debug } : {}) };
      if ("error" in ran) throw new StepError(ran.error, logs);
      return { output: ran.output, ...logs };
    }

    case "call": {
      if (!node.config.workflowId) throw new StepError("pick the flow to call");
      if (!deps.callFlow) throw new StepError("calling flows is not available here");
      // No body template: the called flow gets this run's trigger body.
      const body = node.config.body?.trim() ? renderJson(node.config.body, ctx) : (ctx.trigger.body ?? null);
      const called = await deps.callFlow(node.config.workflowId, body, node.id);
      if (!called.ok) throw new StepError(called.error ?? "the called flow failed", { output: called.output });
      return { output: called.output };
    }

    case "response":
      return {
        output: {
          status: node.config.status,
          body: node.config.body === undefined ? null : renderJson(node.config.body, ctx),
        },
      };
  }
}

async function runHttp(
  config: HttpConfig,
  ctx: TemplateContext,
  deps: EngineDeps,
): Promise<NodeResult> {
  const url = new URL(renderString(config.url, ctx), deps.baseUrl).toString();
  const headers = new Headers();
  for (const [name, template] of Object.entries(config.headers)) headers.set(name, renderString(template, ctx));
  if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_USER_AGENT);
  // The headers as sent (resolved), like the Collections send history.
  let body: string | undefined;
  if (config.body !== undefined && config.method !== "GET") {
    body = JSON.stringify(renderJson(config.body, ctx));
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }
  const request: StepRequest = { method: config.method, url, headers: Object.fromEntries(headers), ...(body !== undefined ? { body: capStepBody(body) } : {}) };

  const started = Date.now();
  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: config.method,
      headers,
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    const err = error as Error & { cause?: { message?: string } };
    // fetch wraps network errors (and blocked addresses) as "fetch failed" with the real reason in `cause`.
    const reason = err.name === "TimeoutError" ? `timed out after ${config.timeoutMs}ms` : (err.cause?.message ?? err.message);
    throw new StepError(`request failed: ${reason}`, { request });
  }

  const text = await readCapped(response);
  let parsed: unknown = text;
  if (response.headers.get("content-type")?.includes("json")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep the raw text when the upstream mislabels its body.
    }
  }

  const output = {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: parsed,
    durationMs: Date.now() - started,
  };
  if (response.status >= 400) throw new StepError(`upstream responded ${response.status}`, { request, output });
  return { output, request };
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new StepError(`response body exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function compare(left: unknown, operator: string, right: unknown): boolean {
  switch (operator) {
    case "exists":
      return left !== undefined && left !== null;
    case "contains":
      if (Array.isArray(left)) return left.some((item) => looseEquals(item, right));
      return String(left ?? "").includes(String(right ?? ""));
    case "==":
      return looseEquals(left, right);
    case "!=":
      return !looseEquals(left, right);
  }
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error(`cannot compare non-numeric values with "${operator}": ${JSON.stringify(left)} vs ${JSON.stringify(right)}`);
  }
  switch (operator) {
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
  }
  throw new Error(`unknown operator "${operator}"`);
}
