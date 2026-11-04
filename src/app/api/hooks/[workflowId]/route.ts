import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { runWorkflow } from "@/lib/workflows/runner";
import { environmentSchema } from "@/lib/workflows/schema";
import { getDeployedWorkflow, getWorkflow } from "@/lib/workflows/store";

/** Live entry point: always executes the deployed snapshot, never the draft being edited. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[workflowId]">) {
  const { workflowId } = await ctx.params;
  const workflow = getDeployedWorkflow(workflowId);
  if (!workflow) {
    return getWorkflow(workflowId)
      ? problem(409, "Conflict", { detail: "workflow has not been deployed yet" })
      : notFound(`workflow "${workflowId}"`);
  }

  const environment = environmentSchema.safeParse(request.nextUrl.searchParams.get("environment") ?? "production");
  if (!environment.success) {
    return problem(400, "Bad Request", { detail: "environment must be production, staging or sandbox" });
  }

  const text = await request.text();
  let body: unknown = null;
  if (text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      return problem(400, "Bad Request", { detail: "webhook body must be valid JSON" });
    }
  }

  const run = await runWorkflow(
    workflow,
    { source: "webhook", body, headers: Object.fromEntries(request.headers) },
    // The deployed snapshot froze its linked requests at deploy time; later Collections edits need a redeploy.
    { baseUrl: request.nextUrl.origin, environment: environment.data, followLinks: false },
  );

  const headers = { "x-reqora-run-id": run.id };
  if (run.output) return Response.json(run.output.body, { status: run.output.status, headers });
  return Response.json({ runId: run.id, status: run.status }, { status: 202, headers });
}
