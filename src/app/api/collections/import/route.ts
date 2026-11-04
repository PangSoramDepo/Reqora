import { notFound, parseBody, problem } from "@/lib/http";
import { ImportError, parseCurl } from "@/lib/collections/curl";
import { importOpenApi } from "@/lib/collections/openapi";
import { collectionExportSchema, importInputSchema } from "@/lib/collections/schema";
import { createRequest, getCollection, insertImported } from "@/lib/collections/store";

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}

/** Validates a Reqora export file; problems are reported with their JSON path. */
function parseReqoraExport(text: string) {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ImportError(`not valid JSON: ${(error as Error).message}`);
  }
  if (!json || typeof json !== "object" || (json as { reqora?: unknown }).reqora !== "collection") {
    throw new ImportError('not a Reqora collection export (expected "reqora": "collection")');
  }
  const parsed = collectionExportSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new ImportError(`invalid Reqora export — ${issues.join("; ")}`);
  }
  return parsed.data.collection;
}

/**
 * `reqora`: creates a collection from a Reqora export file (lossless). `openapi`: creates a collection from the document. `curl`: adds one request to `collectionId`, or to a new
 * collection named after the host. Returns the resulting collection (201).
 */
export async function POST(request: Request) {
  const parsed = await parseBody(request, importInputSchema);
  if ("error" in parsed) return parsed.error;
  const { format, text, collectionId } = parsed.data;

  try {
    if (format === "reqora") {
      const collection = insertImported(parseReqoraExport(text));
      return Response.json(collection, { status: 201, headers: { Location: `/api/collections/${collection.id}` } });
    }
    if (format === "openapi") {
      const collection = insertImported(importOpenApi(text));
      return Response.json(collection, { status: 201, headers: { Location: `/api/collections/${collection.id}` } });
    }

    const { name, definition } = parseCurl(text);
    if (collectionId) {
      const result = createRequest(collectionId, { name, definition });
      if (!result.ok) return notFound(`collection "${collectionId}"`);
      return Response.json(getCollection(collectionId), { status: 201, headers: { Location: `/api/requests/${result.request.id}` } });
    }
    const collection = insertImported({
      name: hostOf(definition.url) ?? "Imported cURL",
      folders: [],
      requests: [{ name, definition }],
    });
    return Response.json(collection, { status: 201, headers: { Location: `/api/collections/${collection.id}` } });
  } catch (error) {
    if (error instanceof ImportError) return problem(422, "Unprocessable Content", { detail: error.message });
    throw error;
  }
}
