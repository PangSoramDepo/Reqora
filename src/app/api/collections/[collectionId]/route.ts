import { connection } from "next/server";
import { notFound, parseBody } from "@/lib/http";
import { collectionPatchSchema } from "@/lib/collections/schema";
import { deleteCollection, getCollection, updateCollection } from "@/lib/collections/store";

type Ctx = RouteContext<"/api/collections/[collectionId]">;

export async function GET(_request: Request, ctx: Ctx) {
  await connection();
  const { collectionId } = await ctx.params;
  const collection = getCollection(collectionId);
  return collection ? Response.json(collection) : notFound(`collection "${collectionId}"`);
}

export async function PATCH(request: Request, ctx: Ctx) {
  const { collectionId } = await ctx.params;
  const parsed = await parseBody(request, collectionPatchSchema);
  if ("error" in parsed) return parsed.error;
  const collection = updateCollection(collectionId, parsed.data);
  return collection ? Response.json(collection) : notFound(`collection "${collectionId}"`);
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const { collectionId } = await ctx.params;
  return deleteCollection(collectionId) ? new Response(null, { status: 204 }) : notFound(`collection "${collectionId}"`);
}
