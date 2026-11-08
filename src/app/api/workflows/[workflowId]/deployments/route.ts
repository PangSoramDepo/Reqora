import { connection, type NextRequest } from "next/server";
import { listDeployments, workflowWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

/** Deployment history, newest first; the first entry is what the webhook runs now. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/workflows/[workflowId]/deployments">) {
  await connection();
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "viewer", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  return Response.json({ data: listDeployments(workflowId) });
}
