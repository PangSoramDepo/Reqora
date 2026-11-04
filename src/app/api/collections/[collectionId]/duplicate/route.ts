import { notFound } from "@/lib/http";
import { duplicateCollection } from "@/lib/collections/store";

/** Copies a collection with its settings, folders, requests and examples as "<name> Copy". */
export async function POST(_request: Request, ctx: RouteContext<"/api/collections/[collectionId]/duplicate">) {
  const { collectionId } = await ctx.params;
  const copy = duplicateCollection(collectionId);
  if (!copy) return notFound(`collection "${collectionId}"`);
  return Response.json(copy, { status: 201, headers: { Location: `/api/collections/${copy.id}` } });
}
