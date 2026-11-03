import { notFound, parseBody, problem } from "@/lib/http";
import { requestCreateSchema } from "@/lib/collections/schema";
import { createRequest } from "@/lib/collections/store";

export async function POST(request: Request, ctx: RouteContext<"/api/collections/[collectionId]/requests">) {
  const { collectionId } = await ctx.params;
  const parsed = await parseBody(request, requestCreateSchema);
  if ("error" in parsed) return parsed.error;

  const result = createRequest(collectionId, parsed.data);
  if (result.ok) {
    return Response.json(result.request, { status: 201, headers: { Location: `/api/requests/${result.request.id}` } });
  }
  if (result.reason === "folder_mismatch") {
    return problem(422, "Unprocessable Content", { detail: "folderId does not belong to this collection" });
  }
  return notFound(`collection "${collectionId}"`);
}
