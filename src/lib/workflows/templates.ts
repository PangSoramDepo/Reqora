import type { WorkflowInput } from "./schema";

/** Starting point for a new workflow: a trigger wired to a response that echoes the payload. */
export function blankWorkflow(name: string): WorkflowInput {
  return {
    name,
    nodes: [
      {
        id: "trigger",
        name: "Webhook Trigger",
        type: "webhook",
        position: { x: 80, y: 140 },
        config: { method: "POST", path: "/hooks/new-event" },
      },
      {
        id: "respond",
        name: "Response",
        type: "response",
        position: { x: 500, y: 140 },
        config: { status: 200, body: '{ "received": {{trigger.body}} }' },
      },
    ],
    edges: [{ id: "e1", source: "trigger", sourcePort: "out", target: "respond" }],
  };
}
