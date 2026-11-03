import { notFound } from "@/lib/http";
import { deleteExample } from "@/lib/collections/store";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/examples/[exampleId]">) {
  const { exampleId } = await ctx.params;
  return deleteExample(exampleId) ? new Response(null, { status: 204 }) : notFound(`example "${exampleId}"`);
}
