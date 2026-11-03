import { NextResponse, type NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { hashPassword } from "@/lib/auth/password";
import { signupOpen, signupSchema } from "@/lib/auth/schema";
import { startSession } from "@/lib/auth/session";
import { countUsers, findUserByEmail, insertUser } from "@/lib/auth/store";

export async function POST(request: NextRequest) {
  if (!signupOpen(countUsers())) {
    return problem(403, "Forbidden", { detail: "sign-up is closed; ask a workspace member to create your account" });
  }
  const parsed = await parseBody(request, signupSchema);
  if ("error" in parsed) return parsed.error;
  const { name, email, password, remember } = parsed.data;

  const passwordHash = await hashPassword(password);
  // Re-check after the (async) hash: the check-and-insert below is synchronous, so it can't interleave.
  if (!signupOpen(countUsers())) {
    return problem(403, "Forbidden", { detail: "sign-up is closed; ask a workspace member to create your account" });
  }
  if (findUserByEmail(email)) return problem(409, "Conflict", { detail: "an account with this email already exists" });

  const user = insertUser({ name, email, passwordHash });
  const response = NextResponse.json({ id: user.id, email: user.email, name: user.name }, { status: 201 });
  startSession(response, request, user.id, remember);
  return response;
}
