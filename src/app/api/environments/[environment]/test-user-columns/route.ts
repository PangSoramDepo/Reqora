import type { NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { columnOrderSchema } from "@/lib/users/schema";
import { reorderColumns } from "@/lib/users/store";
import { environmentSchema } from "@/lib/workflows/schema";
import { activeWorkspace } from "@/lib/workspaces/access";

/** Reorders the test-user columns: `{ order: [every column name] }`. 409 when the columns changed meanwhile. */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/environments/[environment]/test-user-columns">) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  const parsed = await parseBody(request, columnOrderSchema);
  if ("error" in parsed) return parsed.error;
  const columns = reorderColumns({ workspaceId: access.workspaceId, environment: env.data }, parsed.data.order);
  if (!columns) return problem(409, "Conflict", { detail: "the columns changed — reload and try again" });
  return Response.json({ columns });
}
