import { connection, type NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { MissingKeyError } from "@/lib/secrets/crypto";
import { importInputSchema } from "@/lib/users/schema";
import { exportTestUsers, importTestUsers } from "@/lib/users/store";
import { environmentSchema } from "@/lib/workflows/schema";
import { activeWorkspace } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/environments/[environment]/test-users/import">;

/** CSV of the environment's test users (secret columns left empty), to edit and import again. */
export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  return new Response(exportTestUsers({ workspaceId: access.workspaceId, environment: env.data }), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="test-users-${env.data}.csv"`,
      "cache-control": "no-store",
    },
  });
}

/** Imports users from CSV (`user,roles,<column>,…`); existing names are updated. */
export async function POST(request: NextRequest, ctx: Ctx) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  const parsed = await parseBody(request, importInputSchema);
  if ("error" in parsed) return parsed.error;
  try {
    return Response.json(importTestUsers({ workspaceId: access.workspaceId, environment: env.data }, parsed.data.csv));
  } catch (error) {
    if (error instanceof MissingKeyError) return problem(503, "Service Unavailable", { detail: error.message });
    throw error;
  }
}
