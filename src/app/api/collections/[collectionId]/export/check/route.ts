import { connection, type NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { scanCollection } from "@/lib/collections/secret-scan";
import { exportCollection, collectionWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

/**
 * Values in the collection that look like real credentials typed into requests, scripts or saved examples
 * (masked), so the export can warn before the file is shared. `{ findings: [] }` when nothing was found.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/collections/[collectionId]/export/check">) {
  await connection();
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "viewer", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const exported = exportCollection(collectionId);
  if (!exported) return notFound(`collection "${collectionId}"`);
  return Response.json({ findings: scanCollection(exported) });
}
