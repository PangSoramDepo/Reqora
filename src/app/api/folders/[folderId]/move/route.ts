import { notFound, parseBody } from "@/lib/http";
import { folderMoveSchema } from "@/lib/collections/schema";
import { moveFolder } from "@/lib/collections/store";

/** Reorders a folder within its collection. */
export async function POST(request: Request, ctx: RouteContext<"/api/folders/[folderId]/move">) {
  const { folderId } = await ctx.params;
  const parsed = await parseBody(request, folderMoveSchema);
  if ("error" in parsed) return parsed.error;
  const folder = moveFolder(folderId, parsed.data.index);
  return folder ? Response.json(folder) : notFound(`folder "${folderId}"`);
}
