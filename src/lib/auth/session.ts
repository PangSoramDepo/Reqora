import "server-only";

import type { NextRequest, NextResponse } from "next/server";
import { problem } from "@/lib/http";
import { createSession, userForSession, type User } from "./store";

export { safeNext } from "./next-path";

export const SESSION_COOKIE = "reqora_session";

const HOUR = 3_600_000;
/** Without "remember device" the cookie dies with the browser and the server-side session after 12h. */
const SHORT_TTL = 12 * HOUR;
const REMEMBER_TTL = 30 * 24 * HOUR;

export function startSession(response: NextResponse, request: NextRequest, userId: string, remember: boolean) {
  const { token, expiresAt } = createSession(userId, remember ? REMEMBER_TTL : SHORT_TTL);
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure whenever we're served over HTTPS; plain-http localhost keeps working in development.
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    ...(remember ? { expires: expiresAt } : {}),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export function sessionUser(request: NextRequest): User | undefined {
  return userForSession(request.cookies.get(SESSION_COOKIE)?.value);
}

/**
 * Defense in depth for sensitive handlers: the proxy already rejects anonymous requests, but a
 * handler that touches secrets re-checks rather than trusting routing configuration alone.
 */
export function requireUser(request: NextRequest): { user: User } | { error: Response } {
  const user = sessionUser(request);
  return user ? { user } : { error: problem(401, "Unauthorized", { detail: "sign in required" }) };
}

