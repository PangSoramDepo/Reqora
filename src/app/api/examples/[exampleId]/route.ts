import type { NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { deleteExample, exampleWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

export async function DELETE(request: NextRequest, ctx: RouteContext<"/api/examples/[exampleId]">) {
  const { exampleId } = await ctx.params;
  const access = accessTo(request, exampleWorkspace(exampleId), "editor", `example "${exampleId}"`);
  if ("error" in access) return access.error;
  return deleteExample(exampleId) ? new Response(null, { status: 204 }) : notFound(`example "${exampleId}"`);
}
