import { connection, type NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { getRun, runWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

export async function GET(request: NextRequest, ctx: RouteContext<"/api/runs/[runId]">) {
  await connection();
  const { runId } = await ctx.params;
  const access = accessTo(request, runWorkspace(runId), "viewer", `run "${runId}"`);
  if ("error" in access) return access.error;
  const run = getRun(runId);
  return run ? Response.json(run) : notFound(`run "${runId}"`);
}
