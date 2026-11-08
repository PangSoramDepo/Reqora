import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { requestMoveSchema } from "@/lib/collections/schema";
import { collectionWorkspace, moveRequest, requestWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

/** Moves a request to a position in a collection's root or a folder (possibly in another collection). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[requestId]/move">) {
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "editor", `request "${requestId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, requestMoveSchema);
  if ("error" in parsed) return parsed.error;
  if (collectionWorkspace(parsed.data.collectionId) !== access.workspaceId) return notFound(`collection "${parsed.data.collectionId}"`);
  const result = moveRequest(requestId, parsed.data);
  if (result.ok) return Response.json(result.request);
  if (result.reason === "folder_mismatch") {
    return problem(422, "Unprocessable Content", { detail: "the folder does not belong to the target collection" });
  }
  return notFound(result.reason === "request_not_found" ? `request "${requestId}"` : `collection "${parsed.data.collectionId}"`);
}
