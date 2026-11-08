import { connection, type NextRequest } from "next/server";
import { MIN_PASSWORD_LENGTH, hashPassword } from "@/lib/auth/password";
import { findUserByEmail, insertUser } from "@/lib/auth/store";
import { parseBody, problem } from "@/lib/http";
import { accessTo } from "@/lib/workspaces/access";
import { memberInputSchema } from "@/lib/workspaces/schema";
import { addMember, listMembers, workspaceExists } from "@/lib/workspaces/store";

type Ctx = RouteContext<"/api/workspaces/[workspaceId]/members">;

const known = (id: string) => (workspaceExists(id) ? id : undefined);

/** The workspace's members with their roles (any member can see them). */
export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, known(workspaceId), "viewer", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  return Response.json({ data: listMembers(workspaceId) });
}

/**
 * Adds someone by email (owners). Someone without an account needs `name` and a first `password`, which the
 * owner shares with them; they can change it after signing in.
 */
export async function POST(request: NextRequest, ctx: Ctx) {
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, known(workspaceId), "owner", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, memberInputSchema);
  if ("error" in parsed) return parsed.error;
  const { email, role, name, password } = parsed.data;

  let user = findUserByEmail(email);
  let created = false;
  if (!user) {
    if (!name || !password) {
      return problem(422, "Unprocessable Content", {
        detail: "no account uses this email yet: give their name and a first password to create one",
        issues: [{ path: "password", message: "required for a new account" }],
      });
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return problem(422, "Unprocessable Content", {
        detail: `password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        issues: [{ path: "password", message: `at least ${MIN_PASSWORD_LENGTH} characters` }],
      });
    }
    const passwordHash = await hashPassword(password);
    // Re-check after the (async) hash, in case the account was created meanwhile.
    user = findUserByEmail(email) ?? { ...insertUser({ email, name, passwordHash }), passwordHash };
    created = true;
  }

  const result = addMember(workspaceId, user.id, role);
  if (!result.ok) return problem(409, "Conflict", { detail: `${user.email} is already a member` });
  return Response.json({ ...result.member, accountCreated: created }, { status: 201 });
}
