import { connection, type NextRequest } from "next/server";
import { clearSends, listSends } from "@/lib/collections/history";

/** Recent Collections sends (newest first) for the Live Execution Console. */
export async function GET(request: NextRequest) {
  await connection();
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  return Response.json({ data: listSends(Number.isFinite(limit) ? limit : 25) });
}

/** Clears the send log (the console's "Clear"). Saved requests and workflow runs are not affected. */
export async function DELETE() {
  return Response.json({ deleted: clearSends() });
}
