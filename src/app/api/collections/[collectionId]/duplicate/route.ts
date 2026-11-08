import type { NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { duplicateCollection, collectionWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

/** Copies a collection with its settings, folders, requests and examples as "<name> Copy". */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/collections/[collectionId]/duplicate">) {
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "editor", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const copy = duplicateCollection(collectionId);
  if (!copy) return notFound(`collection "${collectionId}"`);
  return Response.json(copy, { status: 201, headers: { Location: `/api/collections/${copy.id}` } });
}
