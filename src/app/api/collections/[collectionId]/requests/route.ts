import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { requestCreateSchema } from "@/lib/collections/schema";
import { createRequest, collectionWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

export async function POST(request: NextRequest, ctx: RouteContext<"/api/collections/[collectionId]/requests">) {
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "editor", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, requestCreateSchema);
  if ("error" in parsed) return parsed.error;

  const result = createRequest(collectionId, parsed.data);
  if (result.ok) {
    return Response.json(result.request, { status: 201, headers: { Location: `/api/requests/${result.request.id}` } });
  }
  if (result.reason === "folder_mismatch") {
    return problem(422, "Unprocessable Content", { detail: "folderId does not belong to this collection" });
  }
  return notFound(`collection "${collectionId}"`);
}
