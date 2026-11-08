import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { getLoadTest, stopLoadTest } from "@/lib/loadtest/runner";
import { loadTestWorkspace } from "@/lib/loadtest/store";
import { accessTo } from "@/lib/workspaces/access";

/** Stops a running test (requests in flight are cancelled and left out) and returns its final report. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/load-tests/[loadTestId]/stop">) {
  const { loadTestId } = await ctx.params;
  const access = accessTo(request, loadTestWorkspace(loadTestId), "editor", `load test "${loadTestId}"`);
  if ("error" in access) return access.error;
  const final = await stopLoadTest(loadTestId);
  if (final) return Response.json(final);
  const test = getLoadTest(loadTestId);
  if (!test) return notFound(`load test "${loadTestId}"`);
  return problem(409, "Conflict", { detail: `load test is not running (status ${test.status})` });
}
