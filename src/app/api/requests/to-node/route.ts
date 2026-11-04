import { notFound, parseBody, problem } from "@/lib/http";
import { resolveEffective } from "@/lib/collections/inherit";
import { toNodeInputSchema } from "@/lib/collections/schema";
import { getRequest, requestScopes } from "@/lib/collections/store";
import { requestToHttpConfig } from "@/lib/collections/to-node";

/**
 * Converts a saved request (`requestId`) or an unsaved one (`definition` + location) into a workflow http node
 * config with collection/folder auth and headers applied. The caller places it on the canvas.
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, toNodeInputSchema);
  if ("error" in parsed) return parsed.error;

  let source;
  if ("requestId" in parsed.data) {
    const saved = getRequest(parsed.data.requestId);
    if (!saved) return notFound(`request "${parsed.data.requestId}"`);
    source = { name: saved.name, definition: saved.definition, collectionId: saved.collectionId, folderId: saved.folderId };
  } else {
    source = parsed.data;
  }

  const scopes = requestScopes(source.collectionId, source.folderId);
  const effective = resolveEffective({ name: source.name, definition: source.definition }, scopes.collection, scopes.folder);
  const converted = requestToHttpConfig(source.name, source.definition, effective);
  return converted.ok
    ? Response.json(converted.draft)
    : problem(422, "Unprocessable Content", { detail: converted.error });
}
