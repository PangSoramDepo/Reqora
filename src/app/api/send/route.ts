import type { NextRequest } from "next/server";
import { parseBody } from "@/lib/http";
import { sendInputSchema } from "@/lib/collections/schema";
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
  const outcome = await sendRequest(
    { name, definition, ...requestScopes(collectionId, folderId) },
    { environment, baseUrl: request.nextUrl.origin },
  );
  // Recorded for the Live Execution Console (status, timing, tests and script output; no body).
  recordSend({ requestId, collectionId, name, method: definition.method, url: definition.url, environment }, outcome);
  return Response.json(outcome);
}
