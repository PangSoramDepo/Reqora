import { syncLinkedNodes } from "@/lib/collections/linked";
import { notFound, parseBody, problem } from "@/lib/http";
import { deployInputSchema } from "@/lib/workflows/schema";
import { deployWorkflow } from "@/lib/workflows/store";

/**
 * Makes the given draft version live on the webhook endpoint. Linked http nodes are frozen with their
 * Collections request as it is now; later edits to that request need a redeploy to reach the webhook.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/workflows/[workflowId]/deploy">) {
  const { workflowId } = await ctx.params;
  const parsed = await parseBody(request, deployInputSchema);
  if ("error" in parsed) return parsed.error;

  const result = deployWorkflow(workflowId, parsed.data.version, syncLinkedNodes);
  if (result.ok) return Response.json(result.workflow);
  if (result.reason === "not_found") return notFound(`workflow "${workflowId}"`);
  return problem(409, "Conflict", {
    detail: `version ${parsed.data.version} is not the latest (current ${result.current}); save and deploy again`,
  });
}
