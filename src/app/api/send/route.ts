import type { NextRequest } from "next/server";
import { notFound, parseBody } from "@/lib/http";
import { sendInputSchema, type SendOutcome } from "@/lib/collections/schema";
import { recordSend } from "@/lib/collections/history";
import { sendRequest } from "@/lib/collections/send";
import { collectionWorkspace, requestScopes } from "@/lib/collections/store";
import { activeWorkspace } from "@/lib/workspaces/access";

/**
 * Sends an ad-hoc (possibly unsaved) definition. With collectionId/folderId it inherits that collection's and
 * folder's auth, headers and scripts. Upstream failures are a 200 with `{ error }`.
 */
export async function POST(request: NextRequest) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const { workspaceId } = access;
  const parsed = await parseBody(request, sendInputSchema);
  if ("error" in parsed) return parsed.error;
  const { definition, environment, collectionId, folderId, requestId, name = "request" } = parsed.data;
  // Inherit only from a collection of the same workspace.
  if (collectionId && collectionWorkspace(collectionId) !== workspaceId) return notFound(`collection "${collectionId}"`);
  // Like Postman, the response panel and the Live Execution Console show real values (the sender chose the
  // environment; stored workflow run history stays scrubbed).
  let raw: SendOutcome | undefined;
  const scrubbed = await sendRequest(
    { name, definition, ...requestScopes(collectionId, folderId) },
    {
      workspaceId,
      environment,
      baseUrl: request.nextUrl.origin,
      onUnscrubbed: (outcome) => {
        raw = outcome;
        recordSend({ workspaceId, requestId, collectionId, name, method: definition.method, url: definition.url, environment }, outcome);
      },
    },
  );
  return Response.json(raw ?? scrubbed);
}
