import { connection, type NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { MissingKeyError } from "@/lib/secrets/crypto";
import { userInputSchema } from "@/lib/users/schema";
import { createTestUser, listTestUsers } from "@/lib/users/store";
import { environmentSchema } from "@/lib/workflows/schema";
import { activeWorkspace } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/environments/[environment]/test-users">;

/** The active workspace's test users in one environment, their columns and login settings (secrets come back null). */
export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  return Response.json(listTestUsers({ workspaceId: access.workspaceId, environment: env.data }));
}

/** Adds a test user; new value names become columns. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  const parsed = await parseBody(request, userInputSchema);
  if ("error" in parsed) return parsed.error;
  try {
    const result = createTestUser({ workspaceId: access.workspaceId, environment: env.data }, parsed.data);
    if (!result.ok) return problem(409, "Conflict", { detail: `a test user named "${parsed.data.name}" already exists in ${env.data}` });
    return Response.json(result.user, { status: 201, headers: { Location: `/api/test-users/${result.user.id}` } });
  } catch (error) {
    if (error instanceof MissingKeyError) return problem(503, "Service Unavailable", { detail: error.message });
    throw error;
  }
}
