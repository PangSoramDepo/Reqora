import type { NodeType, WorkflowNode } from "./schema";

const NAMES: Record<NodeType, string> = {
  webhook: "Webhook Trigger",
  http: "Send HTTP",
  condition: "Condition",
  transform: "Data Mapping",
  delay: "Delay",
  response: "Response",
};

/** A fresh, valid node of the given type; `taken` ids are avoided. */
export function newNode(type: NodeType, position: { x: number; y: number }, taken: Iterable<string>): WorkflowNode {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`${type}-${n}`)) n += 1;
  const base = { id: `${type}-${n}`, name: n === 1 ? NAMES[type] : `${NAMES[type]} ${n}`, position };

  switch (type) {
    case "webhook":
      return { ...base, type, config: { method: "POST", path: "/hooks/new-event" } };
    case "http":
      return { ...base, type, config: { method: "GET", url: "https://", headers: {}, timeoutMs: 10_000 } };
    case "condition":
      return { ...base, type, config: { left: "{{trigger.body.value}}", operator: "exists" } };
    case "transform":
      return { ...base, type, config: { output: { value: "{{trigger.body}}" } } };
    case "delay":
      return { ...base, type, config: { ms: 1000 } };
    case "response":
      return { ...base, type, config: { status: 200, body: '{ "ok": true }' } };
  }
}

/** MIME type used when dragging a node type from the Node Library onto the canvas. */
export const NODE_DRAG_MIME = "application/x-reqora-node-type";

/** MIME type carrying a saved request id when dragging a request (explorer reorder, or onto the Flow Canvas). */
export const REQUEST_DRAG_MIME = "application/x-reqora-request";

/** Window event the sidebar fires to add a saved request to the canvas without dragging (e.g. double-click). */
export const ADD_REQUEST_EVENT = "reqora:add-request";

/** Window event the Node Library fires to add a node without dragging (e.g. double-click). */
export const ADD_NODE_EVENT = "reqora:add-node";
