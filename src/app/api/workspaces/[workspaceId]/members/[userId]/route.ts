import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { accessTo } from "@/lib/workspaces/access";
import { memberRoleSchema } from "@/lib/workspaces/schema";
import { removeMember, setMemberRole, workspaceExists } from "@/lib/workspaces/store";

type Ctx = RouteContext<"/api/workspaces/[workspaceId]/members/[userId]">;

const known = (id: string) => (workspaceExists(id) ? id : undefined);
const LAST_OWNER = "a workspace needs at least one owner: make someone else an owner first";

/** Changes a member's role (owners). */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { workspaceId, userId } = await ctx.params;
  const access = accessTo(request, known(workspaceId), "owner", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, memberRoleSchema);
  if ("error" in parsed) return parsed.error;
  const result = setMemberRole(workspaceId, userId, parsed.data.role);
  if (result.ok) return Response.json(result.member);
  if (result.reason === "last_owner") return problem(409, "Conflict", { detail: LAST_OWNER });
  return notFound(`member "${userId}"`);
}

/** Removes a member (owners), or leaves the workspace (anyone, with their own user id). */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { workspaceId, userId } = await ctx.params;
  const self = accessTo(request, known(workspaceId), "viewer", `workspace "${workspaceId}"`);
  if ("error" in self) return self.error;
  if (self.user.id !== userId && self.role !== "owner") {
    return problem(403, "Forbidden", { detail: "only workspace owners can do this" });
  }
  const result = removeMember(workspaceId, userId);
  if (result.ok) return new Response(null, { status: 204 });
  if (result.reason === "last_owner") return problem(409, "Conflict", { detail: LAST_OWNER });
  return notFound(`member "${userId}"`);
}
