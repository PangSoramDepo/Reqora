import type { NextRequest } from "next/server";
import { parseBody } from "@/lib/http";
import { sendInputSchema, type SendOutcome } from "@/lib/collections/schema";
import { recordSend } from "@/lib/collections/history";
import { sendRequest } from "@/lib/collections/send";
import { requestScopes } from "@/lib/collections/store";

/**
 * Sends an ad-hoc (possibly unsaved) definition. With collectionId/folderId it inherits that collection's and
 * folder's auth, headers and scripts. Upstream failures are a 200 with `{ error }`.
 */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, sendInputSchema);
  if ("error" in parsed) return parsed.error;
  const { definition, environment, collectionId, folderId, requestId, name = "request" } = parsed.data;
  // Like Postman, the response panel and the Live Execution Console show real values (the sender chose the
  // environment; stored workflow run history stays scrubbed).
  let raw: SendOutcome | undefined;
  const scrubbed = await sendRequest(
    { name, definition, ...requestScopes(collectionId, folderId) },
    {
      environment,
      baseUrl: request.nextUrl.origin,
      onUnscrubbed: (outcome) => {
        raw = outcome;
        recordSend({ requestId, collectionId, name, method: definition.method, url: definition.url, environment }, outcome);
      },
    },
  );
  return Response.json(raw ?? scrubbed);
}
