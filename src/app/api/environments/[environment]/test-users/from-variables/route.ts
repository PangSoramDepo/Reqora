import type { NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { MissingKeyError } from "@/lib/secrets/crypto";
import { fromVariablesSchema } from "@/lib/users/schema";
import { userFromVariables } from "@/lib/users/store";
import { environmentSchema } from "@/lib/workflows/schema";
import { activeWorkspace } from "@/lib/workspaces/access";

/**
 * Creates a test user from environment variables (copied under the same names, secrets stay secret), so a setup
 * with one user's login_id and tokens as variables moves over in one step. The variables are kept.
 */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/environments/[environment]/test-users/from-variables">) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  const parsed = await parseBody(request, fromVariablesSchema);
  if ("error" in parsed) return parsed.error;
  try {
    const result = userFromVariables({ workspaceId: access.workspaceId, environment: env.data }, parsed.data);
    if (result.ok) return Response.json(result.user, { status: 201 });
    if (result.reason === "missing") return problem(422, "Unprocessable Content", { detail: `not set in ${env.data}: ${result.names.join(", ")}` });
    return problem(409, "Conflict", { detail: `a test user named "${parsed.data.name}" already exists in ${env.data}` });
  } catch (error) {
    if (error instanceof MissingKeyError) return problem(503, "Service Unavailable", { detail: error.message });
    throw error;
  }
}
