import { connection, type NextRequest } from "next/server";
import { notFound, parseBody } from "@/lib/http";
import { exampleInputSchema } from "@/lib/collections/schema";
import { createExample, getRequest, listExamples, requestWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/requests/[requestId]/examples">;

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "viewer", `request "${requestId}"`);
  if ("error" in access) return access.error;
  if (!getRequest(requestId)) return notFound(`request "${requestId}"`);
  return Response.json({ data: listExamples(requestId) });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { requestId } = await ctx.params;
  const access = accessTo(request, requestWorkspace(requestId), "editor", `request "${requestId}"`);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, exampleInputSchema);
  if ("error" in parsed) return parsed.error;
  const example = createExample(requestId, parsed.data.name, parsed.data.response);
  if (!example) return notFound(`request "${requestId}"`);
  return Response.json(example, { status: 201, headers: { Location: `/api/examples/${example.id}` } });
}
