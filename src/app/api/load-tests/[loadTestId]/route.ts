import { connection, type NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { getLoadTest } from "@/lib/loadtest/runner";
import { loadTestWorkspace } from "@/lib/loadtest/store";
import { accessTo } from "@/lib/workspaces/access";

/** The full report: live while the test runs, final once it ends. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/load-tests/[loadTestId]">) {
  await connection();
  const { loadTestId } = await ctx.params;
  const access = accessTo(request, loadTestWorkspace(loadTestId), "viewer", `load test "${loadTestId}"`);
  if ("error" in access) return access.error;
  const test = getLoadTest(loadTestId);
  return test ? Response.json(test) : notFound(`load test "${loadTestId}"`);
}
