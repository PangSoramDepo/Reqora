import { connection, type NextRequest } from "next/server";
import { parseBody } from "@/lib/http";
import { collectionInputSchema } from "@/lib/collections/schema";
import { createCollection, listCollections } from "@/lib/collections/store";
import { activeWorkspace } from "@/lib/workspaces/access";

/** The collections of the active workspace. */
export async function GET(request: NextRequest) {
  // SQLite reads are synchronous, so opt out of prerendering explicitly.
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  return Response.json({ data: listCollections(access.workspaceId) });
}

export async function POST(request: NextRequest) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, collectionInputSchema);
  if ("error" in parsed) return parsed.error;
  const collection = createCollection(access.workspaceId, parsed.data);
  return Response.json(collection, { status: 201, headers: { Location: `/api/collections/${collection.id}` } });
}
