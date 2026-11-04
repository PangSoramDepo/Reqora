import { DEFAULT_USER_AGENT } from "@/lib/user-agent";
import { topologicalOrder } from "./graph";
import type { RunStatus, RunTrigger, Step, Workflow, WorkflowNode } from "./schema";
import { TemplateError, renderJson, renderString, renderValue, type TemplateContext } from "./template";

const MAX_RESPONSE_BYTES = 1_000_000;

type HttpConfig = Extract<WorkflowNode, { type: "http" }>["config"];

export type LinkedResult = { ok: boolean; error?: string; request?: Step["request"]; output?: unknown };
export type ProgressEvent = { type: "node"; nodeId: string } | { type: "step"; step: Step };

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
  sendLinked?: (requestId: string, ctx: Pick<TemplateContext, "trigger" | "nodes">) => Promise<LinkedResult>;
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

type NodeResult = { output?: unknown; port?: string; request?: Step["request"] };

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
      node.type === "webhook" || incoming.some((e) => takenPorts.get(e.source) === e.sourcePort);
    const stepStart = now();
    const base = { nodeId: node.id, nodeType: node.type, name: node.name, startedAt: new Date(stepStart).toISOString() };

    if (failure || !reached) {
      record({ ...base, status: "skipped", durationMs: 0 });
      continue;
    }

    deps.onProgress?.({ type: "node", nodeId: node.id });
    try {
      const result = await runNode(node, ctx, deps, sleep);
      const port = result.port ?? "out";
      ctx.nodes[node.id] = result.output;
      takenPorts.set(node.id, port);
      if (node.type === "response") output = result.output as ExecutionResult["output"];
      record({
        ...base,
        status: "succeeded",
        durationMs: now() - stepStart,
        port: node.type === "response" ? undefined : port,
        request: result.request,
        output: result.output,
      });
    } catch (error) {
      failure = `${node.name}: ${(error as Error).message}`;
      const partial = error instanceof StepError ? error.partial : {};
      record({ ...base, status: "failed", durationMs: now() - stepStart, ...partial, error: (error as Error).message });
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
): Promise<NodeResult> {
  switch (node.type) {
    case "webhook":
      return { output: { body: ctx.trigger.body ?? null, headers: ctx.trigger.headers ?? {} } };

    case "http": {
      if (!node.config.requestId || !deps.sendLinked) return runHttp(node.config, ctx, deps);
      const linked = await deps.sendLinked(node.config.requestId, { trigger: ctx.trigger, nodes: ctx.nodes });
      if (!linked.ok) throw new StepError(linked.error ?? "linked request failed", { request: linked.request, output: linked.output });
      return { output: linked.output, request: linked.request };
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
  // Record header templates, not resolved values, so secrets never land in run history.
  const request = { method: config.method, url, headers: config.headers };

  const headers = new Headers();
  for (const [name, template] of Object.entries(config.headers)) headers.set(name, renderString(template, ctx));
  if (!headers.has("user-agent")) headers.set("user-agent", DEFAULT_USER_AGENT);
  let body: string | undefined;
  if (config.body !== undefined && config.method !== "GET") {
    body = JSON.stringify(renderJson(config.body, ctx));
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  }

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
    const reason = (error as Error).name === "TimeoutError" ? `timed out after ${config.timeoutMs}ms` : (error as Error).message;
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

/** Template values are often strings ("500") compared to numbers (500); treat those as equal. */
function looseEquals(a: unknown, b: unknown): boolean {
  if (typeof a === "object" || typeof b === "object") return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}
