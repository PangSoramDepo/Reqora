import { NextResponse, type NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { dummyHash, verifyPassword } from "@/lib/auth/password";
import { clearFailures, recordFailure, retryAfter } from "@/lib/auth/rate-limit";
import { loginSchema } from "@/lib/auth/schema";
import { startSession } from "@/lib/auth/session";
import { findUserByEmail, normalizeEmail } from "@/lib/auth/store";

export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, loginSchema);
  if ("error" in parsed) return parsed.error;
  const { email, password, remember } = parsed.data;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${normalizeEmail(email)}|${ip}`;
  const wait = retryAfter(key);
  if (wait > 0) {
    const response = problem(429, "Too Many Requests", { detail: `too many failed sign-ins; try again in ${Math.ceil(wait / 60)} min` });
    response.headers.set("Retry-After", String(wait));
    return response;
  }

  const user = findUserByEmail(email);
  // Always run a full verify so response time doesn't reveal whether the email exists.
  const valid = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !valid) {
    recordFailure(key);
    return problem(401, "Unauthorized", { detail: "email or password is incorrect" });
  }

  clearFailures(key);
  const response = NextResponse.json({ id: user.id, email: user.email, name: user.name });
  startSession(response, request, user.id, remember);
  return response;
}
