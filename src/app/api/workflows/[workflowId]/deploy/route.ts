import type { NextRequest } from "next/server";
import { sessionUser } from "@/lib/auth/session";
import { notFound, parseBody, problem } from "@/lib/http";
import { deployInputSchema } from "@/lib/workflows/schema";
import { deployWorkflow } from "@/lib/workflows/store";

/**
 * Makes the given draft version live on the webhook endpoint. Http nodes linked to a Collections request
 * still send that request as it is at run time.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workflows/[workflowId]/deploy">) {
  const { workflowId } = await ctx.params;
  const parsed = await parseBody(request, deployInputSchema);
  if ("error" in parsed) return parsed.error;

  const user = sessionUser(request);
  const result = deployWorkflow(workflowId, parsed.data.version, user && { id: user.id, name: user.name });
  if (result.ok) return Response.json(result.workflow);
  if (result.reason === "not_found") return notFound(`workflow "${workflowId}"`);
  return problem(409, "Conflict", {
    detail: `version ${parsed.data.version} is not the latest (current ${result.current}); save and deploy again`,
  });
}
