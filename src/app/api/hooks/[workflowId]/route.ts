import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { runWorkflow, scrub } from "@/lib/workflows/runner";
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

  // `?as.maker=maker01&as.authorizer=auth01` picks the test user per role; others are chosen automatically.
  const users = Object.fromEntries(
    [...request.nextUrl.searchParams].filter(([key]) => key.startsWith("as.") && key.length > 3).map(([key, value]) => [key.slice(3), value]),
  );
  const { run, secrets } = await runWorkflow(
    workflow,
    { source: "webhook", body, headers: Object.fromEntries(request.headers) },
    { baseUrl: request.nextUrl.origin, environment: environment.data, users },
  );

  const headers = { "x-reqora-run-id": run.id };
  // The caller is outside the app: scrub resolved secrets from what it gets back (history keeps real values).
  if (run.output) return Response.json(scrub(run.output.body, secrets), { status: run.output.status, headers });
  return Response.json({ runId: run.id, status: run.status }, { status: 202, headers });
}
