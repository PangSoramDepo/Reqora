import { connection, type NextRequest } from "next/server";
import { clearSends, listSends } from "@/lib/collections/history";
import { activeWorkspace } from "@/lib/workspaces/access";

/** Recent Collections sends (newest first) for the Live Execution Console. */
export async function GET(request: NextRequest) {
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 25);
  return Response.json({ data: listSends(access.workspaceId, Number.isFinite(limit) ? limit : 25) });
}

/** Clears the send log (the console's "Clear"). Saved requests and workflow runs are not affected. */
export async function DELETE(request: NextRequest) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  return Response.json({ deleted: clearSends(access.workspaceId) });
}
