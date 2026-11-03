import { newNode } from "@/lib/workflows/defaults";
import type { Workflow, WorkflowNode } from "@/lib/workflows/schema";
import { buildUrl, headerRecord } from "./request";
import type { RequestDefinition } from "./schema";

type HttpNode = Extract<WorkflowNode, { type: "http" }>;
const NODE_SPACING_X = 280;

/**
 * Converts a saved request into a workflow `http` node placed right of the rightmost node.
 * Returns an error for things workflow nodes can't express (HEAD/OPTIONS, text bodies, templated basic auth).
 */
export function requestToNode(
  name: string,
  def: RequestDefinition,
  workflow: Pick<Workflow, "nodes">,
): { ok: true; node: HttpNode } | { ok: false; error: string } {
  if (def.method === "HEAD" || def.method === "OPTIONS") {
    return { ok: false, error: `Workflow HTTP nodes support GET, POST, PUT, PATCH and DELETE — change the method from ${def.method} first.` };
  }
  if (!def.url.trim()) return { ok: false, error: "The request has no URL." };
  if (def.body.type === "text" && def.method !== "GET" && def.body.text.trim()) {
    return { ok: false, error: "Workflow HTTP nodes send JSON bodies only — switch the body to JSON or clear it." };
  }
  if (def.auth.type === "basic" && `${def.auth.username}${def.auth.password}`.includes("{{")) {
    return {
      ok: false,
      error: "Basic auth with {{templates}} can't be pre-encoded for a workflow node; add an Authorization header instead.",
    };
  }

  const rightmost = workflow.nodes.reduce<WorkflowNode | undefined>((best, n) => (!best || n.position.x > best.position.x ? n : best), undefined);
  const position = rightmost ? { x: rightmost.position.x + NODE_SPACING_X, y: rightmost.position.y } : { x: 80, y: 120 };
  const base = newNode("http", position, workflow.nodes.map((n) => n.id)) as HttpNode;
  const body = def.body.type === "json" && def.method !== "GET" && def.body.text.trim() ? def.body.text : undefined;

  return {
    ok: true,
    node: {
      ...base,
      name: name.trim().slice(0, 120) || base.name,
      config: {
        method: def.method,
        url: buildUrl(def.url, def.params).slice(0, 2000),
        headers: headerRecord(def.headers, def.auth),
        ...(body === undefined ? {} : { body }),
        timeoutMs: def.settings.timeoutMs,
      },
    },
  };
}
