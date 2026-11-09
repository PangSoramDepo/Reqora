import type { NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { loginAs, userHandle } from "@/lib/users/session";
import { getTestUser, markSession, testUserScope } from "@/lib/users/store";
import { DEFAULT_ROLE } from "@/lib/users/schema";
import { accessTo } from "@/lib/workspaces/access";

/**
 * Logs the user in now with the environment's login request (to check it works, or refresh tokens). Answers
 * `{ ok, status, durationMs, saved }` (the values its script saved) or `{ ok: false, error }`.
 * `?logout=1` ends the session instead, so the next step logs in again.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/test-users/[userId]/login">) {
  const { userId } = await ctx.params;
  const scope = testUserScope(userId);
  const access = accessTo(request, scope?.workspaceId, "editor", `test user "${userId}"`);
  if ("error" in access) return access.error;
  const user = getTestUser(userId);
  if (!user || !scope) return notFound(`test user "${userId}"`);
  if (request.nextUrl.searchParams.get("logout")) {
    markSession(userId, null);
    return Response.json({ ok: true, loggedOut: true });
  }
  return Response.json(await loginAs(scope, userHandle(user, user.roles[0] ?? DEFAULT_ROLE), { baseUrl: request.nextUrl.origin }));
}
