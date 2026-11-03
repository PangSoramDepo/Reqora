import { notFound, parseBody } from "@/lib/http";
import { folderPatchSchema } from "@/lib/collections/schema";
import { deleteFolder, renameFolder } from "@/lib/collections/store";

type Ctx = RouteContext<"/api/folders/[folderId]">;

export async function PATCH(request: Request, ctx: Ctx) {
  const { folderId } = await ctx.params;
  const parsed = await parseBody(request, folderPatchSchema);
  if ("error" in parsed) return parsed.error;
  const folder = renameFolder(folderId, parsed.data.name);
  return folder ? Response.json(folder) : notFound(`folder "${folderId}"`);
}

/** Deletes the folder together with the requests inside it. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { folderId } = await ctx.params;
  return deleteFolder(folderId) ? new Response(null, { status: 204 }) : notFound(`folder "${folderId}"`);
}
