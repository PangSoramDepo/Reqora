import { connection, NextResponse, type NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { accessTo } from "@/lib/workspaces/access";
import { workspaceInputSchema, WORKSPACE_COOKIE } from "@/lib/workspaces/schema";
import { deleteWorkspace, renameWorkspace, workspaceExists, workspaceOf, workspacesOf } from "@/lib/workspaces/store";

type Ctx = RouteContext<"/api/workspaces/[workspaceId]">;

const known = (id: string) => (workspaceExists(id) ? id : undefined);

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, known(workspaceId), "viewer", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  return Response.json(workspaceOf(access.user.id, workspaceId));
}

/** Renames the workspace (owners). */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, known(workspaceId), "owner", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, workspaceInputSchema);
  if ("error" in parsed) return parsed.error;
  renameWorkspace(workspaceId, parsed.data.name);
  return Response.json(workspaceOf(access.user.id, workspaceId));
}

/** Deletes the workspace with all its flows, runs, collections and secrets (owners; not your only workspace). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, known(workspaceId), "owner", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  if (workspacesOf(access.user.id).length === 1) {
    return problem(409, "Conflict", { detail: "you can't delete your only workspace; create another one first" });
  }
  if (!deleteWorkspace(workspaceId)) return notFound(`workspace "${workspaceId}"`);
  const response = new NextResponse(null, { status: 204 });
  // Forget it as the active workspace; the next request falls back to another one.
  if (request.cookies.get(WORKSPACE_COOKIE)?.value === workspaceId) response.cookies.delete(WORKSPACE_COOKIE);
  return response;
}
