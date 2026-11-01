import { connection } from "next/server";
import { notFound } from "@/lib/http";
import { getRun } from "@/lib/workflows/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/runs/[runId]">) {
  await connection();
  const { runId } = await ctx.params;
  const run = getRun(runId);
  return run ? Response.json(run) : notFound(`run "${runId}"`);
}
