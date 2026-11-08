import { connection, type NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { getDeployment, workflowWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

/** One deployment with the nodes and edges it deployed. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/workflows/[workflowId]/deployments/[deploymentId]">) {
  await connection();
  const { workflowId, deploymentId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "viewer", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const deployment = getDeployment(workflowId, deploymentId);
  return deployment ? Response.json(deployment) : notFound(`deployment "${deploymentId}"`);
}
