import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { runWorkflow } from "@/lib/workflows/runner";
import { getRun, getWorkflow } from "@/lib/workflows/store";

/** Re-executes a run's trigger payload against the workflow's current version. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/runs/[runId]/replay">) {
  const { runId } = await ctx.params;
  const original = getRun(runId);
  if (!original) return notFound(`run "${runId}"`);

  const workflow = getWorkflow(original.workflowId);
  if (!workflow) return problem(409, "Conflict", { detail: "the run's workflow no longer exists" });

  // Stored trigger headers are redacted, so only the body is replayed.
  const run = await runWorkflow(
    workflow,
    { source: original.trigger.source, body: original.trigger.body },
    { baseUrl: request.nextUrl.origin, environment: original.environment, replayOf: original.id },
  );
  return Response.json(run, { status: 201, headers: { Location: `/api/runs/${run.id}` } });
}
