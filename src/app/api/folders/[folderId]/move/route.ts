import { notFound, parseBody, problem } from "@/lib/http";
import { folderMoveSchema } from "@/lib/collections/schema";
import { moveFolder } from "@/lib/collections/store";

/** Reorders a folder among its siblings, or moves it into another folder (`parentId`; null = top level). */
export async function POST(request: Request, ctx: RouteContext<"/api/folders/[folderId]/move">) {
  const { folderId } = await ctx.params;
  const parsed = await parseBody(request, folderMoveSchema);
  if ("error" in parsed) return parsed.error;
  const result = moveFolder(folderId, parsed.data.index, parsed.data.parentId);
  if (result.ok) return Response.json(result.folder);
  if (result.reason === "folder_not_found") return notFound(`folder "${folderId}"`);
  const detail = result.reason === "into_itself" ? "a folder can't move into itself or one of its sub-folders" : "parentId does not belong to the folder's collection";
  return problem(422, "Unprocessable Content", { detail });
}
