import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { MissingKeyError } from "@/lib/secrets/crypto";
import { userPatchSchema } from "@/lib/users/schema";
import { deleteTestUser, getTestUser, testUserScope, updateTestUser } from "@/lib/users/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/test-users/[userId]">;

export async function GET(request: NextRequest, ctx: Ctx) {
  const { userId } = await ctx.params;
  const access = accessTo(request, testUserScope(userId)?.workspaceId, "viewer", `test user "${userId}"`);
  if ("error" in access) return access.error;
  return Response.json(getTestUser(userId));
}

/** Renames a user, sets their roles, and sets or clears values (null clears; new names become columns). */
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { userId } = await ctx.params;
  const access = accessTo(request, testUserScope(userId)?.workspaceId, "editor", `test user "${userId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, userPatchSchema);
  if ("error" in parsed) return parsed.error;
  try {
    const result = updateTestUser(userId, parsed.data);
    if (result.ok) return Response.json(result.user);
    if (result.reason === "name_taken") return problem(409, "Conflict", { detail: `a test user named "${parsed.data.name}" already exists` });
    return notFound(`test user "${userId}"`);
  } catch (error) {
    if (error instanceof MissingKeyError) return problem(503, "Service Unavailable", { detail: error.message });
    throw error;
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { userId } = await ctx.params;
  const access = accessTo(request, testUserScope(userId)?.workspaceId, "editor", `test user "${userId}"`);
  if ("error" in access) return access.error;
  return deleteTestUser(userId) ? new Response(null, { status: 204 }) : notFound(`test user "${userId}"`);
}
