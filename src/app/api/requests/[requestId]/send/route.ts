import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { sendRequest } from "@/lib/collections/send";
import { getRequest, requestScopes } from "@/lib/collections/store";
import { environmentSchema } from "@/lib/workflows/schema";

/** Sends the saved request with its collection/folder settings. Upstream failures are a 200 with `{ error }`. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[requestId]/send">) {
  const { requestId } = await ctx.params;
  const environment = environmentSchema.safeParse(request.nextUrl.searchParams.get("environment") ?? "production");
  if (!environment.success) {
    return problem(400, "Bad Request", { detail: "environment must be production, staging or sandbox" });
  }
  const saved = getRequest(requestId);
  if (!saved) return notFound(`request "${requestId}"`);
  return Response.json(
    await sendRequest(
      { name: saved.name, definition: saved.definition, ...requestScopes(saved.collectionId, saved.folderId) },
      { environment: environment.data, baseUrl: request.nextUrl.origin },
    ),
  );
}
