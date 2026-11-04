import type { NodeType } from "@/lib/workflows/schema";

type Doc = { summary: string; config: string[]; outputs: string[]; tips: string[] };

/** In-app reference for each node type, shown by the Node Inspector's help button. */
export const NODE_DOCS: Record<NodeType, Doc> = {
  webhook: {
    summary: "The trigger. Every run starts here, with the payload sent to the webhook (or the test payload on the canvas).",
    config: ["Method and path describe what callers send; the live endpoint is POST /api/hooks/{workflowId}.", "Exactly one per workflow; it can't be disabled."],
    outputs: ["{{trigger.body.field}} — the JSON payload", "{{trigger.headers.name}} — request headers (webhook runs)"],
    tips: ["Webhook calls run the deployed version; canvas runs use the draft.", "Edit the canvas test payload with the { } button next to Emit Webhook Test."],
  },
  http: {
    summary: "Sends an HTTP request. A node dropped from Collections stays linked: it sends that saved request with its auth, scripts and tests.",
    config: [
      "URL, headers and JSON body accept templates: {{env.NAME}}, {{trigger.body.x}}, {{node-id.body.x}}.",
      "Responses with status ≥ 400 fail the step (and skip the nodes after it).",
      "Relative URLs (/api/...) go to Reqora itself; private network addresses are blocked unless allowed.",
    ],
    outputs: ["{{id.status}} — HTTP status", "{{id.body.field}} — parsed JSON body", "{{id.headers.name}} — response headers", "{{id.durationMs}}"],
    tips: ["Copy cURL (next to Run) shows the request with templates unresolved.", "Linked nodes: edit in Collections, or Unlink to edit here."],
  },
  condition: {
    summary: "Compares two values and continues down the TRUE or FALSE output.",
    config: [
      "Left / right accept templates, e.g. {{trigger.body.amount}} > 500.",
      "Operators: == != > >= < <= contains exists. Numeric comparisons need numbers on both sides.",
    ],
    outputs: ["{{id.result}} — true or false", "Connect the true and false ports to different nodes"],
    tips: ["A missing value fails the step (\"cannot compare…\"): check the field path in the previous node's output.", "Disabled conditions let the run continue down both branches."],
  },
  transform: {
    summary: "Builds a new object from templates — rename, combine or pick fields for later nodes.",
    config: ["Each output key gets a template value, e.g. total = {{trigger.body.amount}}."],
    outputs: ["{{id.key}} — each key you defined"],
    tips: ["A template that is exactly one reference keeps its type (numbers stay numbers)."],
  },
  delay: {
    summary: "Waits before continuing (up to 10 seconds).",
    config: ["Delay in milliseconds."],
    outputs: ["{{id.delayedMs}}"],
    tips: ["Useful for rate-limited APIs or waiting for eventual consistency."],
  },
  response: {
    summary: "Sets what the webhook caller receives: status code and JSON body.",
    config: ["Status code and a JSON body template, e.g. { \"orderId\": \"{{trigger.body.id}}\" }."],
    outputs: ["Becomes the HTTP response of POST /api/hooks/{workflowId}"],
    tips: ["Without a Response node, webhook callers get 202 with the run id."],
  },
};

export function NodeDocs({ type, nodeId }: { type: NodeType; nodeId: string }) {
  const doc = NODE_DOCS[type];
  const section = (title: string, items: string[]) => (
    <div className="flex flex-col gap-0.5">
      <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{title}</span>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => (
          <li key={item} className="font-body-sm text-body-sm text-on-surface-variant">
            • {item.replaceAll("{{id.", `{{${nodeId}.`)}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div data-testid="node-docs" className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-surface-container-lowest/80">
      <p className="font-body-sm text-body-sm text-on-surface">{doc.summary}</p>
      {section("Configure", doc.config)}
      {section("Outputs", doc.outputs)}
      {section("Tips", doc.tips)}
    </div>
  );
}
