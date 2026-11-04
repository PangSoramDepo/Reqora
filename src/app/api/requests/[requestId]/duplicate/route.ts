import { notFound } from "@/lib/http";
import { duplicateRequest } from "@/lib/collections/store";

/** Copies a saved request (and its examples) as "<name> Copy", right after the original. */
export async function POST(_request: Request, ctx: RouteContext<"/api/requests/[requestId]/duplicate">) {
  const { requestId } = await ctx.params;
  const copy = duplicateRequest(requestId);
  if (!copy) return notFound(`request "${requestId}"`);
  return Response.json(copy, { status: 201, headers: { Location: `/api/requests/${copy.id}` } });
}
