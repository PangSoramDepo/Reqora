import { connection, type NextRequest } from "next/server";
import { problem } from "@/lib/http";
import { deleteRuns, queryRuns } from "@/lib/workflows/store";
import { windowStart } from "@/lib/workflows/windows";

export async function GET(request: NextRequest) {
  await connection();
  const params = request.nextUrl.searchParams;

  const range = windowStart(params.get("since"));
  if (!range) return problem(400, "Bad Request", { detail: "since must be one of 24h, 7d, 30d" });

  const limit = Number(params.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return problem(400, "Bad Request", { detail: "limit must be an integer between 1 and 100" });
  }

  const status = params.get("status") ?? undefined;
  if (status !== undefined && status !== "succeeded" && status !== "failed") {
    return problem(400, "Bad Request", { detail: "status must be succeeded or failed" });
  }

  return Response.json({
    data: queryRuns({ limit, since: range.since, status, workflowId: params.get("workflowId") ?? undefined }),
  });
}

/**
 * Permanently deletes stored runs: all of them, or one workflow's with `?workflowId=`. Run history, replays and
 * telemetry lose them; deployments and load-test reports are kept.
 */
export async function DELETE(request: NextRequest) {
  const workflowId = request.nextUrl.searchParams.get("workflowId") ?? undefined;
  return Response.json({ deleted: deleteRuns(workflowId) });
}
