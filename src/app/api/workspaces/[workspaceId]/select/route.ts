import { NextResponse, type NextRequest } from "next/server";
import { accessTo } from "@/lib/workspaces/access";
import { selectWorkspace } from "@/lib/workspaces/cookie";
import { workspaceExists, workspaceOf } from "@/lib/workspaces/store";

/** Makes the workspace the active one in this browser (any member). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]/select">) {
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, workspaceExists(workspaceId) ? workspaceId : undefined, "viewer", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  const response = NextResponse.json(workspaceOf(access.user.id, workspaceId));
  selectWorkspace(response, request, workspaceId);
  return response;
}
