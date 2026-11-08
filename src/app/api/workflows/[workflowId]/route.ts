import { connection, type NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { syncLinkedNodes } from "@/lib/collections/linked";
import { validateGraph } from "@/lib/workflows/graph";
import { workflowReplaceSchema } from "@/lib/workflows/schema";
import { deleteWorkflow, getWorkflow, replaceWorkflow, workflowWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/workflows/[workflowId]">;

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "viewer", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const workflow = getWorkflow(workflowId);
  // Linked http nodes show their Collections request as it is now.
  return workflow ? Response.json(syncLinkedNodes(workflow)) : notFound(`workflow "${workflowId}"`);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "editor", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, workflowReplaceSchema);
  if ("error" in parsed) return parsed.error;

  const { version, ...input } = parsed.data;
  const issues = validateGraph(input);
  if (issues.length) return problem(422, "Unprocessable Content", { detail: "invalid workflow graph", issues });

  const result = replaceWorkflow(workflowId, input, version);
  if (result.ok) return Response.json(result.workflow);
  if (result.reason === "not_found") return notFound(`workflow "${workflowId}"`);
  return problem(409, "Conflict", {
    detail: `workflow was modified (current version ${result.current}, request was based on ${version}); reload and retry`,
  });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "editor", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  return deleteWorkflow(workflowId) ? new Response(null, { status: 204 }) : notFound(`workflow "${workflowId}"`);
}
