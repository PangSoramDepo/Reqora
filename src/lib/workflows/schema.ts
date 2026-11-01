import { z } from "zod";

// Keep in sync with api/openapi.yaml.

const nodeId = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/, "must start with a letter; letters, digits, _ and - only");
const httpMethod = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const position = z.object({ x: z.number().finite(), y: z.number().finite() });

const nodeBase = {
  id: nodeId,
  name: z.string().min(1).max(120),
  position,
};

export const webhookNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("webhook"),
  config: z.object({ method: httpMethod, path: z.string().max(500) }),
});

export const httpNodeSchema = z.object({
  ...nodeBase,
  type: z.literal("http"),
  config: z.object({
    method: httpMethod,
    url: z.string().min(1).max(2000),
    headers: z.record(z.string(), z.string().max(4000)).default({}),
    body: z.string().max(100_000).optional(),
    timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
  }),
});

export const conditionOperators = ["==", "!=", ">", ">=", "<", "<=", "contains", "exists"] as const;

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

export const runInputSchema = z.object({
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

export type Workflow = WorkflowInput & {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowSummary = {
  id: string;
  name: string;
  description?: string;
  version: number;
  nodeCount: number;
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
};

export type RunTrigger = {
  source: "manual" | "webhook";
  body?: unknown;
  headers?: Record<string, string>;
};

export type Run = {
  id: string;
  workflowId: string;
  workflowVersion: number;
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
  response: [],
};
