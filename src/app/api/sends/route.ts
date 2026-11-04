import { connection, type NextRequest } from "next/server";
import { listSends } from "@/lib/collections/history";

/** Recent Collections sends (newest first) for the Live Execution Console. */
export async function GET(request: NextRequest) {
  await connection();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  return Response.json({ data: listSends(Number.isFinite(limit) ? limit : 25) });
}
