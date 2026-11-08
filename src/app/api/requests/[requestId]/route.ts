import { connection, type NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { requestReplaceSchema } from "@/lib/collections/schema";
import { deleteRequest, getRequest, replaceRequest, requestWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/requests/[requestId]">;

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "viewer", `request "${requestId}"`);
  if ("error" in access) return access.error;
  const saved = getRequest(requestId);
  return saved ? Response.json(saved) : notFound(`request "${requestId}"`);
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "editor", `request "${requestId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, requestReplaceSchema);
  if ("error" in parsed) return parsed.error;

  const result = replaceRequest(requestId, parsed.data);
  if (result.ok) return Response.json(result.request);
  if (result.reason === "folder_mismatch") {
    return problem(422, "Unprocessable Content", { detail: "folderId does not belong to the request's collection" });
  }
  return notFound(`request "${requestId}"`);
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "editor", `request "${requestId}"`);
  if ("error" in access) return access.error;
  return deleteRequest(requestId) ? new Response(null, { status: 204 }) : notFound(`request "${requestId}"`);
}
