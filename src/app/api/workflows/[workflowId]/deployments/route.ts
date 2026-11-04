import { connection } from "next/server";
import { notFound } from "@/lib/http";
import { getWorkflow, listDeployments } from "@/lib/workflows/store";

/** Deployment history, newest first; the first entry is what the webhook runs now. */
export async function GET(_request: Request, ctx: RouteContext<"/api/workflows/[workflowId]/deployments">) {
  await connection();
  const { workflowId } = await ctx.params;
  if (!getWorkflow(workflowId)) return notFound(`workflow "${workflowId}"`);
  return Response.json({ data: listDeployments(workflowId) });
}
