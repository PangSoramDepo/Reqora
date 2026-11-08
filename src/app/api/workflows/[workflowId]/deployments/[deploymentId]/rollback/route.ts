import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { rollbackDeployment, workflowWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

/** Makes an earlier deployment live again for the webhook (recorded as a new history entry); the draft is kept. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workflows/[workflowId]/deployments/[deploymentId]/rollback">) {
  const { workflowId, deploymentId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "editor", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const result = rollbackDeployment(workflowId, deploymentId, { id: access.user.id, name: access.user.name });
  if (result.ok) return Response.json(result.workflow);
  if (result.reason === "already_live") return problem(409, "Conflict", { detail: "that deployment is already live" });
  return notFound(`deployment "${deploymentId}"`);
}
