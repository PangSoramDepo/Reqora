import type { NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { clearFailures, recordFailure, retryAfter } from "@/lib/auth/rate-limit";
import { changePasswordSchema } from "@/lib/auth/schema";
import { requireUser, SESSION_COOKIE } from "@/lib/auth/session";
import { passwordHashOf, updatePassword } from "@/lib/auth/store";

/**
 * Changes the signed-in user's password after checking the current one. Every other session of the user is
 * signed out; this one stays signed in. Failed attempts are rate-limited like sign-in.
 */
export async function POST(request: NextRequest) {
  const auth = requireUser(request);
  if ("error" in auth) return auth.error;
  const parsed = await parseBody(request, changePasswordSchema);
  if ("error" in parsed) return parsed.error;
  const { currentPassword, newPassword } = parsed.data;

  const key = `password|${auth.user.id}`;
  const wait = retryAfter(key);
  if (wait > 0) {
    const response = problem(429, "Too Many Requests", { detail: `too many failed attempts; try again in ${Math.ceil(wait / 60)} min` });
    response.headers.set("Retry-After", String(wait));
    return response;
  }

  const hash = passwordHashOf(auth.user.id);
  if (!hash || !(await verifyPassword(currentPassword, hash))) {
    recordFailure(key);
    return problem(400, "Bad Request", { detail: "current password is incorrect" });
  }
  clearFailures(key);
  if (await verifyPassword(newPassword, hash)) {
    return problem(400, "Bad Request", { detail: "the new password must be different from the current one" });
  }

  updatePassword(auth.user.id, await hashPassword(newPassword), request.cookies.get(SESSION_COOKIE)?.value);
  return new Response(null, { status: 204 });
}
