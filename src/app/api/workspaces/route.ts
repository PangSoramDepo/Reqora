import { connection, NextResponse, type NextRequest } from "next/server";
import { parseBody } from "@/lib/http";
import { activeWorkspace } from "@/lib/workspaces/access";
import { selectWorkspace } from "@/lib/workspaces/cookie";
import { workspaceInputSchema } from "@/lib/workspaces/schema";
import { createWorkspace, workspacesOf } from "@/lib/workspaces/store";

/** The signed-in user's workspaces (with their role in each) and which one is active. */
export async function GET(request: NextRequest) {
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  return Response.json({ data: workspacesOf(access.user.id), active: access.workspaceId });
}

/** Creates a workspace owned by the signed-in user and makes it the active one. */
export async function POST(request: NextRequest) {
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, workspaceInputSchema);
  if ("error" in parsed) return parsed.error;
  const workspace = createWorkspace(parsed.data.name, access.user.id);
  const response = NextResponse.json(workspace, { status: 201, headers: { Location: `/api/workspaces/${workspace.id}` } });
  selectWorkspace(response, request, workspace.id);
  return response;
}
