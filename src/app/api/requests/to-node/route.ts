import type { NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { resolveEffective } from "@/lib/collections/inherit";
import { toNodeInputSchema } from "@/lib/collections/schema";
import { collectionWorkspace, getRequest, requestScopes, requestWorkspace } from "@/lib/collections/store";
import { activeWorkspace } from "@/lib/workspaces/access";
import { requestToHttpConfig } from "@/lib/collections/to-node";

/**
 * Converts a saved request (`requestId`) or an unsaved one (`definition` + location) into a workflow http node
 * config with collection/folder auth and headers applied. The caller places it on the canvas.
 */
export async function POST(request: NextRequest) {
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, toNodeInputSchema);
  if ("error" in parsed) return parsed.error;

  let source;
  if ("requestId" in parsed.data) {
    const saved = getRequest(parsed.data.requestId);
    if (!saved || requestWorkspace(saved.id) !== access.workspaceId) return notFound(`request "${parsed.data.requestId}"`);
    source = { name: saved.name, definition: saved.definition, collectionId: saved.collectionId, folderId: saved.folderId };
  } else {
    source = parsed.data;
    if (source.collectionId && collectionWorkspace(source.collectionId) !== access.workspaceId) {
      return notFound(`collection "${source.collectionId}"`);
    }
  }

  const scopes = requestScopes(source.collectionId, source.folderId);
  const effective = resolveEffective({ name: source.name, definition: source.definition }, scopes.collection, scopes.folders);
  const converted = requestToHttpConfig(source.name, source.definition, effective, { linked: "requestId" in parsed.data });
  if (!converted.ok) return problem(422, "Unprocessable Content", { detail: converted.error });
  // A saved request stays linked: runs rebuild the node from it, so later edits in Collections apply.
  const { draft } = converted;
  return Response.json("requestId" in parsed.data ? { ...draft, config: { ...draft.config, requestId: parsed.data.requestId } } : draft);
}
