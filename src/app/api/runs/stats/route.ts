import { connection, type NextRequest } from "next/server";
import { problem } from "@/lib/http";
import { runStats } from "@/lib/workflows/store";
import { windowStart } from "@/lib/workflows/windows";

export async function GET(request: NextRequest) {
  await connection();
  const range = windowStart(request.nextUrl.searchParams.get("since"));
  if (!range) return problem(400, "Bad Request", { detail: "since must be one of 24h, 7d, 30d" });
  return Response.json({ window: range.window, since: range.since, ...runStats(range.since) });
}
