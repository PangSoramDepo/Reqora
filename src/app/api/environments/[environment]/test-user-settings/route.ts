import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { requestWorkspace } from "@/lib/collections/store";
import { settingsInputSchema } from "@/lib/users/schema";
import { putSettings } from "@/lib/users/store";
import { environmentSchema } from "@/lib/workflows/schema";
import { activeWorkspace } from "@/lib/workspaces/access";

/**
 * Sets the environment's login request (sent as a user before they act; its post-response script saves tokens with
 * rq.user.set) and how long a login is reused. Changing it ends every user's session.
 */
export async function PUT(request: NextRequest, ctx: RouteContext<"/api/environments/[environment]/test-user-settings">) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });
  const parsed = await parseBody(request, settingsInputSchema);
  if ("error" in parsed) return parsed.error;
  const { loginRequestId } = parsed.data;
  if (loginRequestId && requestWorkspace(loginRequestId) !== access.workspaceId) return notFound(`request "${loginRequestId}"`);
  return Response.json(putSettings({ workspaceId: access.workspaceId, environment: env.data }, parsed.data));
}
