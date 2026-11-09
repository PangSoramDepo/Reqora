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
      "{{user.NAME}} is the acting test user's value (e.g. {{user.access_token}}); with roles in the flow, Run as picks which role's user sends this step.",
    ],
    outputs: ["{{id.status}} — HTTP status", "{{id.body.field}} — parsed JSON body", "{{id.headers.name}} — response headers", "{{id.durationMs}}"],
    tips: ["Copy cURL (next to Run) shows the request with templates unresolved.", "Linked nodes: Edit request (or click the URL, headers or body) edits the saved request in a dialog without leaving the canvas; Unlink to edit a separate copy instead."],
  },
  condition: {
    summary: "Compares two values and continues down the TRUE or FALSE output.",
    config: [
      "Left / right accept templates, e.g. {{trigger.body.amount}} > 500.",
      "Operators: == != > >= < <= contains exists. Numeric comparisons need numbers on both sides.",
      "Lists: {{node-id.body.items[status='paid'].length}} > 0 checks that some item matches; [0] / [-1] pick the first / last item.",
    ],
    outputs: ["{{id.result}} — true or false", "Connect the true and false ports to different nodes"],
    tips: ["A missing value fails the step (\"cannot compare…\"): check the field path in the previous node's output.", "Disabled conditions let the run continue down both branches."],
  },
  transform: {
    summary: "Builds a new object from templates — rename, combine or pick fields for later nodes.",
    config: [
      "Each output key gets a template value, e.g. total = {{trigger.body.amount}}.",
      "Filter a list: {{node-id.body.records[grp='PettyCash'][0].account_number}} — the first matching item's field. Also != > >= < <=.",
      "Map a list: {{node-id.body.records.account_number}} — that field from every item, as a list. [0] / [-1] pick the first / last item; .length counts.",
    ],
    outputs: ["{{id.key}} — each key you defined"],
    tips: ["A template that is exactly one reference keeps its type (numbers stay numbers, lists stay lists).", "No match gives an empty value; add a Condition with exists to branch on it."],
  },
  delay: {
    summary: "Waits before continuing (up to 10 seconds).",
    config: ["Delay in milliseconds."],
    outputs: ["{{id.delayedMs}}"],
    tips: ["Useful for rate-limited APIs or waiting for eventual consistency."],
  },
  script: {
    summary: "Runs JavaScript between nodes — prepare values before a request, or check and reshape a response after one.",
    config: [
      "trigger.body / trigger.headers — the payload; nodes[\"node-id\"] — an earlier node's output, e.g. nodes[\"http-2\"].body.data.",
      "rq.environment.get/set (saved to the run's environment), rq.variables (shared with linked requests), console.log, require(\"lodash\"), moment…",
      "Throwing an error (or a failed rq.test) fails the step.",
    ],
    outputs: ["{{id.key}} — each key of the returned object", "{{id.value}} — a returned string, number, boolean or array"],
    tips: ["console.log output shows under Last Run Output and in Execution History's Console Logs.", "Place it before a node to prepare data, or after one to inspect its response."],
  },
  call: {
    summary: "Runs another flow and waits for it to finish, so shared steps (log in, look up a customer…) can live in one flow and be reused.",
    config: [
      "Flow: the flow to call. Its deployed (live) version runs; a flow that was never deployed runs its draft.",
      "Trigger body: a JSON template sent as the called flow's {{trigger.body}}, e.g. { \"customerId\": \"{{trigger.body.id}}\" }. Empty sends this run's trigger body.",
      "The called flow runs in the same environment. If it fails, this step fails too.",
    ],
    outputs: [
      "{{id.body.field}} — the called flow's Response node body",
      "{{id.status}} — its Response status (null without a Response node)",
      "{{id.runId}} — the called run, listed in Execution History",
    ],
    tips: [
      "Deploy the called flow after changing it: callers run its live version.",
      `Flows can call flows up to 5 levels deep; a flow that ends up calling itself fails with "loop".`,
    ],
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
