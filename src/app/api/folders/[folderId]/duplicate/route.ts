import { notFound } from "@/lib/http";
import { duplicateFolder } from "@/lib/collections/store";

/** Copies a folder with its settings and requests as "<name> Copy", right after the original. */
export async function POST(_request: Request, ctx: RouteContext<"/api/folders/[folderId]/duplicate">) {
  const { folderId } = await ctx.params;
  const copy = duplicateFolder(folderId);
  if (!copy) return notFound(`folder "${folderId}"`);
  return Response.json(copy, { status: 201, headers: { Location: `/api/folders/${copy.id}` } });
}
