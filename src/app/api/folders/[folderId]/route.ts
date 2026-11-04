import { notFound, parseBody } from "@/lib/http";
import { folderPatchSchema } from "@/lib/collections/schema";
import { deleteFolder, updateFolder } from "@/lib/collections/store";

type Ctx = RouteContext<"/api/folders/[folderId]">;

/** Renames the folder and/or replaces its inherited settings (auth, headers, scripts). */
export async function PATCH(request: Request, ctx: Ctx) {
  const { folderId } = await ctx.params;
  const parsed = await parseBody(request, folderPatchSchema);
  if ("error" in parsed) return parsed.error;
  const folder = updateFolder(folderId, parsed.data);
  return folder ? Response.json(folder) : notFound(`folder "${folderId}"`);
}

/** Deletes the folder together with the requests inside it. */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { folderId } = await ctx.params;
  return deleteFolder(folderId) ? new Response(null, { status: 204 }) : notFound(`folder "${folderId}"`);
}
