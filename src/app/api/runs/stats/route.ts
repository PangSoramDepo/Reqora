import { connection, type NextRequest } from "next/server";
import { problem } from "@/lib/http";
import { runStats } from "@/lib/workflows/store";
import { windowStart } from "@/lib/workflows/windows";
import { activeWorkspace } from "@/lib/workspaces/access";

export async function GET(request: NextRequest) {
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const range = windowStart(request.nextUrl.searchParams.get("since"));
  if (!range) return problem(400, "Bad Request", { detail: "since must be one of 24h, 7d, 30d" });
  return Response.json({ window: range.window, since: range.since, ...runStats(access.workspaceId, range.since) });
}
