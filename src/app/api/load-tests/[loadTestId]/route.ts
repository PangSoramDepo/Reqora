import { connection } from "next/server";
import { notFound } from "@/lib/http";
import { getLoadTest } from "@/lib/loadtest/runner";

/** The full report: live while the test runs, final once it ends. */
export async function GET(_request: Request, ctx: RouteContext<"/api/load-tests/[loadTestId]">) {
  await connection();
  const { loadTestId } = await ctx.params;
  const test = getLoadTest(loadTestId);
  return test ? Response.json(test) : notFound(`load test "${loadTestId}"`);
}
