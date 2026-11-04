import { z } from "zod";
import { notFound, parseBody, problem } from "@/lib/http";
import { validateGraph } from "@/lib/workflows/graph";
import { getDeployment, getWorkflow, replaceWorkflow } from "@/lib/workflows/store";

const restoreSchema = z.object({ version: z.number().int().min(1) });

/**
 * Replaces the draft with a deployment's nodes and edges (a new draft version), so an earlier version can be
 * edited. `version` is the draft version the caller has seen; the live deployment is unchanged.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[workflowId]/deployments/[deploymentId]/restore">) {
  const { workflowId, deploymentId } = await ctx.params;
  const parsed = await parseBody(request, restoreSchema);
  if ("error" in parsed) return parsed.error;
  const workflow = getWorkflow(workflowId);
  if (!workflow) return notFound(`workflow "${workflowId}"`);
  const deployment = getDeployment(workflowId, deploymentId);
  if (!deployment) return notFound(`deployment "${deploymentId}"`);

  const input = { name: workflow.name, description: workflow.description, nodes: deployment.nodes, edges: deployment.edges };
  const issues = validateGraph(input);
  if (issues.length) return problem(422, "Unprocessable Content", { detail: "that deployment's graph is no longer valid", issues });
  const result = replaceWorkflow(workflowId, input, parsed.data.version);
  if (result.ok) return Response.json(result.workflow);
  if (result.reason === "not_found") return notFound(`workflow "${workflowId}"`);
  return problem(409, "Conflict", {
    detail: `workflow was modified (current version ${result.current}, request was based on ${parsed.data.version}); reload and retry`,
  });
}
