import "server-only";

import type { Workflow, WorkflowNode } from "@/lib/workflows/schema";
import { resolveEffective } from "./inherit";
import { getRequest, requestScopes } from "./store";
import { requestToHttpConfig } from "./to-node";

type HttpConfig = Extract<WorkflowNode, { type: "http" }>["config"];

/**
 * The http node config for a saved request as it is right now, with its collection/folder auth and headers
 * applied. Workflow nodes dropped from Collections keep `requestId` and are rebuilt from this on every run.
 */
export function linkedHttpConfig(requestId: string): { ok: true; config: HttpConfig } | { ok: false; error: string } {
  const saved = getRequest(requestId);
  if (!saved) {
    return { ok: false, error: "the linked Collections request was deleted — unlink the node to keep its last copy" };
  }
  const scopes = requestScopes(saved.collectionId, saved.folderId);
  const effective = resolveEffective({ name: saved.name, definition: saved.definition }, scopes.collection, scopes.folder);
  const converted = requestToHttpConfig(saved.name, saved.definition, effective);
  if (!converted.ok) return { ok: false, error: `the linked request “${saved.name}” can't run in a workflow: ${converted.error}` };
  return { ok: true, config: { ...converted.draft.config, requestId } };
}

/**
 * Refreshes the stored copy on every linked http node, so the canvas (and a deployed snapshot) shows the
 * request as it is now. Nodes whose request is gone or unconvertible keep their last copy.
 */
export function syncLinkedNodes<T extends Pick<Workflow, "nodes">>(workflow: T): T {
  if (!workflow.nodes.some((n) => n.type === "http" && n.config.requestId)) return workflow;
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => {
      if (node.type !== "http" || !node.config.requestId) return node;
      const linked = linkedHttpConfig(node.config.requestId);
      return linked.ok ? { ...node, config: linked.config } : node;
    }),
  };
}
