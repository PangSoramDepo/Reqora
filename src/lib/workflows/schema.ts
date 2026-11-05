import { z } from "zod";

// Keep in sync with api/openapi.yaml.

const nodeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, "must start with a letter; letters, digits, _ and - only");
const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const position = z.object({ x: z.number().finite(), y: z.number().finite() });

const nodeBase = {
  id: nodeId,
  name: z.string().min(1).max(120),
  position,
  /**
   * A disabled node is bypassed: it doesn't execute, and the run continues through all of its outputs to the
   * next nodes. The webhook trigger can't be disabled.
   */
  disabled: z.boolean().optional(),
};

export const webhookNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("webhook"),
  config: z.object({ method: httpMethod, path: z.string().max(500) }),
});

export const conditionOperators = ["==", "!=", ">", ">=", "<", "<=", "contains", "exists"] as const;

/** Longest a node may keep repeating (interval × attempts). */
export const MAX_REPEAT_WAIT_MS = 10 * 60_000;

/**
 * Repeat until: the node sends again every `intervalMs` until the condition is true (then the run continues) or
 * `maxAttempts` sends were made (then the step fails). Templates can read this node's latest response.
 */
export const repeatUntilSchema = z
  .object({
    /** compare: `left operator right` with templates; script: JavaScript that returns true when done. */
    mode: z.enum(["compare", "script"]).default("compare"),
    /** Runs in the script sandbox with `response` (status, headers, parsed body), rq / pm, lodash, moment. */
    script: z.string().max(10_000).optional(),
    /** Empty while being edited; a run fails until it's filled in. */
    left: z.string().max(2000),
    operator: z.enum(conditionOperators),
    right: z.string().max(2000).optional(),
    intervalMs: z.number().int().min(100).max(60_000).default(2_000),
    maxAttempts: z.number().int().min(2).max(100).default(10),
  })
  .refine((r) => r.intervalMs * (r.maxAttempts - 1) <= MAX_REPEAT_WAIT_MS, {
    message: `interval × attempts can wait at most ${MAX_REPEAT_WAIT_MS / 60_000} minutes`,
    path: ["maxAttempts"],
  });
export type RepeatUntil = z.infer<typeof repeatUntilSchema>;

export const httpNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("http"),
  config: z.object({
    method: httpMethod,
    url: z.string().min(1).max(2000),
    headers: z.record(z.string(), z.string().max(4000)).default({}),
    body: z.string().max(100_000).optional(),
    timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
    /**
     * Saved Collections request this node is linked to. Runs rebuild the config from that request (with its
     * collection/folder auth and headers), so edits in Collections apply here; the fields above are its last copy.
     */
    requestId: z.string().min(1).max(100).optional(),
    repeat: repeatUntilSchema.optional(),
  }),
});

export const conditionNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("condition"),
  config: z.object({
    left: z.string().max(2000),
    operator: z.enum(conditionOperators),
    right: z.string().max(2000).optional(),
  }),
});

export const transformNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("transform"),
  config: z.object({ output: z.record(z.string(), z.string().max(4000)) }),
});

export const delayNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("delay"),
  config: z.object({ ms: z.number().int().min(0).max(10_000) }),
});

/** Longest script a Script node may hold. */
export const MAX_NODE_SCRIPT = 20_000;

/**
 * Runs JavaScript in the script sandbox between other nodes: reads `trigger` and earlier `nodes`, rq / pm
 * (environment, variables), lodash, moment… What it returns becomes this node's output.
 */
export const scriptNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("script"),
  config: z.object({ code: z.string().max(MAX_NODE_SCRIPT) }),
});

export const responseNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("response"),
  config: z.object({
    status: z.number().int().min(100).max(599),
    body: z.string().max(100_000).optional(),
  }),
});

export const nodeSchema = z.discriminatedUnion("type", [
  webhookNodeSchema,
  httpNodeSchema,
  conditionNodeSchema,
  transformNodeSchema,
  delayNodeSchema,
  scriptNodeSchema,
  responseNodeSchema,
]);

export const edgeSchema = z.object({
  id: z.string().min(1).max(100),
  source: z.string(),
  sourcePort: z.string(),
  target: z.string(),
});

export const workflowInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  nodes: z.array(nodeSchema).max(200),
  edges: z.array(edgeSchema).max(500),
});

export const workflowReplaceSchema = workflowInputSchema.extend({
  version: z.number().int().min(1),
});

export const ENVIRONMENTS = ["production", "staging", "sandbox"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const environmentSchema = z.enum(ENVIRONMENTS);

/** Environment variable names: letters, digits and _, not starting with a digit (scripts often use login_id style). */
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const variableInputSchema = z.object({
  kind: z.enum(["secret", "plain"]),
  value: z.string().max(10_000),
  description: z.string().max(500).optional(),
});

export const deployInputSchema = z.object({ version: z.number().int().min(1) });

export const runInputSchema = z.object({
  environment: environmentSchema.default("production"),
  trigger: z
    .object({
      body: z.unknown().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export type WorkflowNode = z.infer<typeof nodeSchema>;
export type NodeType = WorkflowNode["type"];
export type WorkflowEdge = z.infer<typeof edgeSchema>;
export type WorkflowInput = z.infer<typeof workflowInputSchema>;

export type Deployment = { version: number; deployedAt: string };

/** One entry of a workflow's deployment history (newest first); `live` marks what webhooks run now. */
export type DeploymentRecord = {
  id: string;
  workflowId: string;
  /** Draft version that was deployed. */
  version: number;
  deployedAt: string;
  deployedBy?: { id: string; name: string };
  /** Set when this entry re-deployed an earlier one. */
  rollbackOf?: { id: string; version: number };
  nodeCount: number;
  edgeCount: number;
  live: boolean;
};

export type DeploymentDetail = DeploymentRecord & Pick<Workflow, "nodes" | "edges">;

export type Workflow = WorkflowInput & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  /** The version live on the webhook endpoint; absent until first deploy. */
  deployment?: Deployment;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  description?: string;
  version: number;
  nodeCount: number;
  updatedAt: string;
  deployment?: Deployment;
};

export type VariableReference = { workflowId: string; workflowName: string; nodeId: string; nodeName: string };

export type Variable = {
  name: string;
  kind: "secret" | "plain";
  /** Plain values only; secrets are write-only and come back as null. */
  value: string | null;
  description?: string;
  updatedAt: string;
};

export type RunStatus = "succeeded" | "failed";
export type StepStatus = "succeeded" | "failed" | "skipped";

export type Step = {
  nodeId: string;
  nodeType: NodeType;
  name: string;
  status: StepStatus;
  startedAt: string;
  durationMs: number;
  port?: string;
  request?: { method: string; url: string; headers: Record<string, string> };
  output?: unknown;
  error?: string;
  /** Skipped because the node is disabled (the run went on through it). */
  disabled?: boolean;
  /** How many times a "repeat until" node sent its request. */
  attempts?: number;
  /** A "repeat until" node's condition checks (most recent 20): result, script console output or error. */
  checks?: RepeatCheck[];
  /** Console output of a script node. */
  logs?: string[];
};
export type RepeatCheck = { attempt: number; met: boolean; logs?: string[]; error?: string };

export type RunTrigger = {
  source: "manual" | "webhook";
  body?: unknown;
  headers?: Record<string, string>;
};

export type Run = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  environment: Environment;
  status: RunStatus;
  trigger: RunTrigger;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  steps: Step[];
  output?: { status: number; body: unknown };
  error?: string;
  /** Set when this run replayed an earlier run's trigger. */
  replayOf?: string;
};

export const RUN_WINDOWS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
export type RunWindow = keyof typeof RUN_WINDOWS;

/** Output ports each node type exposes. */
export const OUTPUT_PORTS: Record<NodeType, readonly string[]> = {
  webhook: ["out"],
  http: ["out"],
  condition: ["true", "false"],
  transform: ["out"],
  delay: ["out"],
  script: ["out"],
  response: [],
};
