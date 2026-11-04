import type { NextRequest } from "next/server";
import { sessionUser } from "@/lib/auth/session";
import { notFound, problem } from "@/lib/http";
import { rollbackDeployment } from "@/lib/workflows/store";

/** Makes an earlier deployment live again for the webhook (recorded as a new history entry); the draft is kept. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workflows/[workflowId]/deployments/[deploymentId]/rollback">) {
  const { workflowId, deploymentId } = await ctx.params;
  const user = sessionUser(request);
  const result = rollbackDeployment(workflowId, deploymentId, user && { id: user.id, name: user.name });
  if (result.ok) return Response.json(result.workflow);
  if (result.reason === "already_live") return problem(409, "Conflict", { detail: "that deployment is already live" });
  return notFound(`deployment "${deploymentId}"`);
}
