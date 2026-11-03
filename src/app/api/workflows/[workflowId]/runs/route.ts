import { connection, type NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { runWorkflow } from "@/lib/workflows/runner";
import { runInputSchema } from "@/lib/workflows/schema";
import { getWorkflow, listRuns } from "@/lib/workflows/store";

type Ctx = RouteContext<"/api/workflows/[workflowId]/runs">;

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { workflowId } = await ctx.params;
  if (!getWorkflow(workflowId)) return notFound(`workflow "${workflowId}"`);

  const raw = request.nextUrl.searchParams.get("limit") ?? "20";
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return problem(400, "Bad Request", { detail: "limit must be an integer between 1 and 100" });
  }
  return Response.json({ data: listRuns(workflowId, limit) });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { workflowId } = await ctx.params;
  const workflow = getWorkflow(workflowId);
  if (!workflow) return notFound(`workflow "${workflowId}"`);

  const parsed = await parseBody(request, runInputSchema, { allowEmpty: true });
  if ("error" in parsed) return parsed.error;

  const { environment, trigger } = parsed.data;
  // Manual runs execute the draft, so changes can be tested before they are deployed.
  const run = await runWorkflow(workflow, { source: "manual", ...trigger }, { baseUrl: request.nextUrl.origin, environment });
  return Response.json(run, { status: 201, headers: { Location: `/api/runs/${run.id}` } });
}
