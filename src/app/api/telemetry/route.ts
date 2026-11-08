import { connection, type NextRequest } from "next/server";
import { problem } from "@/lib/http";
import { computeTelemetry } from "@/lib/telemetry/compute";
import { RUN_WINDOWS } from "@/lib/workflows/schema";
import { countRuns, listWorkflows, queryRuns } from "@/lib/workflows/store";
import { windowStart } from "@/lib/workflows/windows";
import { activeWorkspace } from "@/lib/workspaces/access";

/** Most runs analysed per request; beyond this the newest runs are used and `sampled` is true. */
const MAX_RUNS = 20_000;

/** Aggregated metrics over the active workspace's stored workflow runs for the Telemetry page. */
export async function GET(request: NextRequest) {
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const { workspaceId } = access;
  const params = request.nextUrl.searchParams;
  const now = Date.now();
  const range = windowStart(params.get("since"), now);
  if (!range) return problem(400, "Bad Request", { detail: "since must be one of 24h, 7d, 30d" });

  const runs = queryRuns({ workspaceId, limit: MAX_RUNS, since: range.since });
  const previousSince = new Date(Date.parse(range.since) - RUN_WINDOWS[range.window] * 3_600_000).toISOString();
  const telemetry = computeTelemetry(runs, {
    window: range.window,
    since: range.since,
    now,
    previousRuns: countRuns(workspaceId, previousSince, range.since),
    sampled: runs.length === MAX_RUNS,
    names: new Map(listWorkflows(workspaceId).map((w) => [w.id, w.name])),
    pipelineWorkflowId: params.get("workflowId") ?? undefined,
  });
  return Response.json(telemetry);
}
