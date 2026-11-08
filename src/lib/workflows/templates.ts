import type { WorkflowInput } from "./schema";

const trigger = { id: "trigger", name: "Webhook Trigger", type: "webhook" as const, position: { x: 80, y: 160 }, config: { method: "POST" as const, path: "/hooks/new-event" } };

/** Starting point for a new workflow: a trigger wired to a response that echoes the payload. */
export function blankWorkflow(name: string): WorkflowInput {
  return {
    name,
    nodes: [trigger, { id: "respond", name: "Response", type: "response", position: { x: 500, y: 160 }, config: { status: 200, body: '{ "received": {{trigger.body}} }' } }],
    edges: [{ id: "e1", source: "trigger", sourcePort: "out", target: "respond" }],
  };
}

export type Starter = { id: string; title: string; description: string; icon: string; build: (name: string) => WorkflowInput };

/** Starter flows offered when a workspace has none yet. Each runs as-is against Reqora's local demo APIs. */
export const STARTERS: Starter[] = [
  {
    id: "call-api",
    title: "Call an API",
    description: "Webhook → HTTP request → response with the API's answer. The common shape of most flows.",
    icon: "http",
    build: (name) => ({
      name,
      nodes: [
        trigger,
        {
          id: "http-1",
          name: "Post message",
          type: "http",
          position: { x: 440, y: 160 },
          config: {
            method: "POST",
            url: "/api/demo/slack/messages",
            headers: {},
            body: '{ "channel": "#orders", "text": "New order {{trigger.body.id}}" }',
            timeoutMs: 10_000,
          },
        },
        { id: "respond", name: "Response", type: "response", position: { x: 800, y: 160 }, config: { status: 200, body: '{ "posted": {{http-1.body.ok}}, "ts": "{{http-1.body.ts}}" }' } },
      ],
      edges: [
        { id: "e1", source: "trigger", sourcePort: "out", target: "http-1" },
        { id: "e2", source: "http-1", sourcePort: "out", target: "respond" },
      ],
    }),
  },
  {
    id: "branch",
    title: "Branch on a value",
    description: "A condition sends large orders one way and the rest another, each with its own response.",
    icon: "call_split",
    build: (name) => ({
      name,
      nodes: [
        trigger,
        { id: "condition-1", name: "Large order?", type: "condition", position: { x: 440, y: 160 }, config: { left: "{{trigger.body.amount}}", operator: ">", right: "500" } },
        { id: "large", name: "Large", type: "response", position: { x: 800, y: 60 }, config: { status: 200, body: '{ "route": "review", "id": "{{trigger.body.id}}" }' } },
        { id: "small", name: "Small", type: "response", position: { x: 800, y: 280 }, config: { status: 200, body: '{ "route": "auto", "id": "{{trigger.body.id}}" }' } },
      ],
      edges: [
        { id: "e1", source: "trigger", sourcePort: "out", target: "condition-1" },
        { id: "e2", source: "condition-1", sourcePort: "true", target: "large" },
        { id: "e3", source: "condition-1", sourcePort: "false", target: "small" },
      ],
    }),
  },
  {
    id: "blank",
    title: "Start from scratch",
    description: "Just a trigger and a response that echoes the payload. Add blocks from the Node Library.",
    icon: "add",
    build: blankWorkflow,
  },
];

const shellQuote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/** The live webhook URL of a workflow. */
export const webhookUrl = (origin: string, workflowId: string, environment: string) =>
  `${origin}/api/hooks/${workflowId}${environment === "production" ? "" : `?environment=${environment}`}`;

/** A cURL command that calls the deployed workflow with `payload`. */
export function webhookCurl(origin: string, workflowId: string, environment: string, payload: unknown): string {
  return `curl -X POST ${shellQuote(webhookUrl(origin, workflowId, environment))} \\\n  -H 'content-type: application/json' \\\n  -d ${shellQuote(JSON.stringify(payload ?? {}))}`;
}
