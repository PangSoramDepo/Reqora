import type { VariableReference, Workflow, WorkflowNode } from "./schema";

const ENV_REF = /\{\{\s*env\.([A-Za-z0-9_]+)\s*\}\}/g;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** Variable names a node reads through `{{env.NAME}}`. */
export function envReferences(node: WorkflowNode): string[] {
  return [...new Set(strings(node.config).flatMap((s) => [...s.matchAll(ENV_REF)].map((m) => m[1])))];
}

/** Which workflow nodes read which variables. */
export function variableUsage(workflows: Pick<Workflow, "id" | "name" | "nodes">[]): Map<string, VariableReference[]> {
  const usage = new Map<string, VariableReference[]>();
  for (const workflow of workflows) {
    for (const node of workflow.nodes) {
      for (const name of envReferences(node)) {
        const refs = usage.get(name) ?? [];
        refs.push({ workflowId: workflow.id, workflowName: workflow.name, nodeId: node.id, nodeName: node.name });
        usage.set(name, refs);
      }
    }
  }
  return usage;
}
