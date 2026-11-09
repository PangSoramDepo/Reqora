import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { MissingKeyError } from "@/lib/secrets/crypto";
import { columnInputSchema } from "@/lib/users/schema";
import { deleteColumn, putColumn } from "@/lib/users/store";
import { environmentSchema, VARIABLE_NAME } from "@/lib/workflows/schema";
import { activeWorkspace } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/environments/[environment]/test-user-columns/[name]">;

async function target(request: NextRequest, ctx: Ctx) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access;
  const { environment, name } = await ctx.params;
  const env = environmentSchema.safeParse(environment);
  if (!env.success) return { error: problem(404, "Not Found", { detail: "unknown environment" }) };
  if (!VARIABLE_NAME.test(name)) return { error: problem(400, "Bad Request", { detail: "column names use letters, digits and _ (max 64)" }) };
  return { scope: { workspaceId: access.workspaceId, environment: env.data }, name };
}

/** Adds a column, or changes whether it's secret (existing values are re-encrypted or decrypted). */
export async function PUT(request: NextRequest, ctx: Ctx) {
  const t = await target(request, ctx);
  if ("error" in t) return t.error;
  const parsed = await parseBody(request, columnInputSchema);
  if ("error" in parsed) return parsed.error;
  try {
    return Response.json(putColumn(t.scope, t.name, parsed.data.kind));
  } catch (error) {
    if (error instanceof MissingKeyError) return problem(503, "Service Unavailable", { detail: error.message });
    throw error;
  }
}

/** Removes the column and every user's value in it. */
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const t = await target(request, ctx);
  if ("error" in t) return t.error;
  return deleteColumn(t.scope, t.name) ? new Response(null, { status: 204 }) : notFound(`column "${t.name}"`);
}
