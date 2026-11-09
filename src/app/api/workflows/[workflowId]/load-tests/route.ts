import { connection, type NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { listLoadTests, MAX_RUNNING, startLoadTest } from "@/lib/loadtest/runner";
import { loadTestConfigSchema, toSummary } from "@/lib/loadtest/schema";
import { getWorkflow, workflowWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/workflows/[workflowId]/load-tests">;

/** Recent load tests of the workflow, newest first (summaries; GET /api/load-tests/{id} has the full report). */
export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "viewer", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "20");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return problem(400, "Bad Request", { detail: "limit must be an integer between 1 and 100" });
  }
  return Response.json({ data: listLoadTests(workflowId, limit).map(toSummary) });
}

/** Starts a load test of the workflow's draft in the background; poll GET /api/load-tests/{id} for progress. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "editor", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const workflow = getWorkflow(workflowId);
  if (!workflow) return notFound(`workflow "${workflowId}"`);
  const parsed = await parseBody(request, loadTestConfigSchema);
  if ("error" in parsed) return parsed.error;

  const started = startLoadTest(workflow, parsed.data, { baseUrl: request.nextUrl.origin });
  if (!started.ok) {
    if (started.reason === "unknown_users") return problem(422, "Unprocessable Content", { detail: started.detail });
    return problem(409, "Conflict", { detail: `${MAX_RUNNING} load tests are already running; stop one or wait for it to finish` });
  }
  return Response.json(started.test, { status: 202, headers: { Location: `/api/load-tests/${started.test.id}` } });
}
