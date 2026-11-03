import { connection } from "next/server";
import { parseBody } from "@/lib/http";
import { collectionInputSchema } from "@/lib/collections/schema";
import { createCollection, listCollections } from "@/lib/collections/store";

export async function GET() {
  // SQLite reads are synchronous, so opt out of prerendering explicitly.
  await connection();
  return Response.json({ data: listCollections() });
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, collectionInputSchema);
  if ("error" in parsed) return parsed.error;
  const collection = createCollection(parsed.data);
  return Response.json(collection, { status: 201, headers: { Location: `/api/collections/${collection.id}` } });
}
