import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { folderInputSchema } from "@/lib/collections/schema";
import { createFolder, getCollection, collectionWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

/** Creates a folder at the collection's top level, or inside `parentId` (a sub-folder). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/collections/[collectionId]/folders">) {
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "editor", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, folderInputSchema);
  if ("error" in parsed) return parsed.error;
  if (!getCollection(collectionId)) return notFound(`collection "${collectionId}"`);
  const folder = createFolder(collectionId, parsed.data.name, parsed.data.parentId ?? null);
  if (!folder) return problem(422, "Unprocessable Content", { detail: "parentId does not belong to this collection" });
  return Response.json(folder, { status: 201, headers: { Location: `/api/folders/${folder.id}` } });
}
