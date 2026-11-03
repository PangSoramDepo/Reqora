import { connection } from "next/server";
import { notFound, parseBody } from "@/lib/http";
import { exampleInputSchema } from "@/lib/collections/schema";
import { createExample, getRequest, listExamples } from "@/lib/collections/store";

type Ctx = RouteContext<"/api/requests/[requestId]/examples">;

export async function GET(_request: Request, ctx: Ctx) {
  await connection();
  const { requestId } = await ctx.params;
  if (!getRequest(requestId)) return notFound(`request "${requestId}"`);
  return Response.json({ data: listExamples(requestId) });
}

export async function POST(request: Request, ctx: Ctx) {
  const { requestId } = await ctx.params;
  const parsed = await parseBody(request, exampleInputSchema);
  if ("error" in parsed) return parsed.error;
  const example = createExample(requestId, parsed.data.name, parsed.data.response);
  if (!example) return notFound(`request "${requestId}"`);
  return Response.json(example, { status: 201, headers: { Location: `/api/examples/${example.id}` } });
}
