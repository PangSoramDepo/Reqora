import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { recordSend } from "@/lib/collections/history";
import { sendRequest } from "@/lib/collections/send";
import { getRequest, requestScopes } from "@/lib/collections/store";
import type { SendOutcome } from "@/lib/collections/schema";
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
  let raw: SendOutcome | undefined;
  const scrubbed = await sendRequest(
    { name: saved.name, definition: saved.definition, ...requestScopes(saved.collectionId, saved.folderId) },
    {
      environment: environment.data,
      baseUrl: request.nextUrl.origin,
      // The response and the console log show real values, like Postman.
      onUnscrubbed: (outcome) => {
        raw = outcome;
        recordSend(
          {
            requestId: saved.id,
            collectionId: saved.collectionId,
            name: saved.name,
            method: saved.definition.method,
            url: saved.definition.url,
            environment: environment.data,
          },
          outcome,
        );
      },
    },
  );
  return Response.json(raw ?? scrubbed);
}
