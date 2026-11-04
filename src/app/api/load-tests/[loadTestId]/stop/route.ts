import { notFound, problem } from "@/lib/http";
import { getLoadTest, stopLoadTest } from "@/lib/loadtest/runner";

/** Stops a running test (requests in flight are cancelled and left out) and returns its final report. */
export async function POST(_request: Request, ctx: RouteContext<"/api/load-tests/[loadTestId]/stop">) {
  const { loadTestId } = await ctx.params;
  const final = await stopLoadTest(loadTestId);
  if (final) return Response.json(final);
  const test = getLoadTest(loadTestId);
  if (!test) return notFound(`load test "${loadTestId}"`);
  return problem(409, "Conflict", { detail: `load test is not running (status ${test.status})` });
}
