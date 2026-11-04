import { connection } from "next/server";
import { notFound } from "@/lib/http";
import { getDeployment } from "@/lib/workflows/store";

/** One deployment with the nodes and edges it deployed. */
export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[workflowId]/deployments/[deploymentId]">) {
  await connection();
  const { workflowId, deploymentId } = await ctx.params;
  const deployment = getDeployment(workflowId, deploymentId);
  return deployment ? Response.json(deployment) : notFound(`deployment "${deploymentId}"`);
}
