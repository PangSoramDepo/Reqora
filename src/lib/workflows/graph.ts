import { OUTPUT_PORTS, type WorkflowEdge, type WorkflowInput, type WorkflowNode } from "./schema";

export type GraphIssue = { path: string; message: string };

/**
 * Structural checks zod can't express: unique ids, edges pointing at real nodes/ports,
 * exactly one trigger, and no cycles.
 */
export function validateGraph({ nodes, edges }: Pick<WorkflowInput, "nodes" | "edges">): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const byId = new Map<string, WorkflowNode>();

  nodes.forEach((node, i) => {
    if (byId.has(node.id)) issues.push({ path: `nodes.${i}.id`, message: `duplicate node id "${node.id}"` });
    byId.set(node.id, node);
  });

  const triggers = nodes.filter((n) => n.type === "webhook");
  if (triggers.length !== 1) {
    issues.push({ path: "nodes", message: `expected exactly one webhook trigger node, found ${triggers.length}` });
  }

  nodes.forEach((node, i) => {
    if (node.type === "webhook" && node.disabled) {
      issues.push({ path: `nodes.${i}.disabled`, message: "the webhook trigger can't be disabled" });
    }
  });

  const edgeIds = new Set<string>();
  edges.forEach((edge, i) => {
    if (edgeIds.has(edge.id)) issues.push({ path: `edges.${i}.id`, message: `duplicate edge id "${edge.id}"` });
    edgeIds.add(edge.id);

    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source) issues.push({ path: `edges.${i}.source`, message: `unknown node "${edge.source}"` });
    else if (!OUTPUT_PORTS[source.type].includes(edge.sourcePort)) {
      issues.push({
        path: `edges.${i}.sourcePort`,
        message: `"${source.type}" node has no output port "${edge.sourcePort}"`,
      });
    }
    if (!target) issues.push({ path: `edges.${i}.target`, message: `unknown node "${edge.target}"` });
    else if (target.type === "webhook") {
      issues.push({ path: `edges.${i}.target`, message: "a trigger node cannot have incoming edges" });
    }
  });

  if (issues.length === 0 && topologicalOrder(nodes, edges) === null) {
    issues.push({ path: "edges", message: "graph contains a cycle" });
  }
  return issues;
}

/** Kahn's algorithm; preserves the nodes' array order among ready nodes. Returns null on a cycle. */
export function topologicalOrder(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowNode[] | null {
  const indegree = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);

  const order: WorkflowNode[] = [];
  const done = new Set<string>();
  while (order.length < nodes.length) {
    const next = nodes.find((n) => !done.has(n.id) && indegree.get(n.id) === 0);
    if (!next) return null;
    done.add(next.id);
    order.push(next);
    for (const edge of edges) {
      if (edge.source === next.id) indegree.set(edge.target, indegree.get(edge.target)! - 1);
    }
  }
  return order;
}
