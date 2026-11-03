import { notFound, parseBody } from "@/lib/http";
import { folderInputSchema } from "@/lib/collections/schema";
import { createFolder } from "@/lib/collections/store";

export async function POST(request: Request, ctx: RouteContext<"/api/collections/[collectionId]/folders">) {
  const { collectionId } = await ctx.params;
  const parsed = await parseBody(request, folderInputSchema);
  if ("error" in parsed) return parsed.error;
  const folder = createFolder(collectionId, parsed.data.name);
  if (!folder) return notFound(`collection "${collectionId}"`);
  return Response.json(folder, { status: 201, headers: { Location: `/api/folders/${folder.id}` } });
}
