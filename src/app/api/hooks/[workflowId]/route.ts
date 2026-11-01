import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { runWorkflow } from "@/lib/workflows/runner";
import { getWorkflow } from "@/lib/workflows/store";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/hooks/[workflowId]">) {
  const { workflowId } = await ctx.params;
  const workflow = getWorkflow(workflowId);
  if (!workflow) return notFound(`workflow "${workflowId}"`);

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
    request.nextUrl.origin,
  );

  const headers = { "x-reqora-run-id": run.id };
  if (run.output) return Response.json(run.output.body, { status: run.output.status, headers });
  return Response.json({ runId: run.id, status: run.status }, { status: 202, headers });
}
