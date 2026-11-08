import { connection, type NextRequest } from "next/server";
import { notFound, parseBody } from "@/lib/http";
import { collectionPatchSchema } from "@/lib/collections/schema";
import { deleteCollection, getCollection, updateCollection, collectionWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/collections/[collectionId]">;

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "viewer", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const collection = getCollection(collectionId);
  return collection ? Response.json(collection) : notFound(`collection "${collectionId}"`);
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "editor", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, collectionPatchSchema);
  if ("error" in parsed) return parsed.error;
  const collection = updateCollection(collectionId, parsed.data);
  return collection ? Response.json(collection) : notFound(`collection "${collectionId}"`);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "editor", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  return deleteCollection(collectionId) ? new Response(null, { status: 204 }) : notFound(`collection "${collectionId}"`);
}
