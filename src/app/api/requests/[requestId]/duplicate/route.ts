import type { NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { duplicateRequest, requestWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

/** Copies a saved request (and its examples) as "<name> Copy", right after the original. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[requestId]/duplicate">) {
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "editor", `request "${requestId}"`);
  if ("error" in access) return access.error;
  const copy = duplicateRequest(requestId);
  if (!copy) return notFound(`request "${requestId}"`);
  return Response.json(copy, { status: 201, headers: { Location: `/api/requests/${copy.id}` } });
}
