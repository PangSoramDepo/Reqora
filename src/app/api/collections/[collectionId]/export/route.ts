import { connection } from "next/server";
import { notFound } from "@/lib/http";
import { exportPostman } from "@/lib/collections/postman";
import { exportCollection } from "@/lib/collections/store";

/** File-system-safe name: letters, digits, spaces, - and _ (the rest become -). */
const fileName = (name: string) => name.replace(/[^\w\- ]+/g, "-").trim().slice(0, 80) || "collection";

/**
 * Downloads the collection as a `.reqora.json` file (settings, folders, requests, scripts, examples) that
 * POST /api/collections/import with `format: "reqora"` turns back into a new collection.
 * `?format=postman` downloads a Postman Collection v2.1 instead (templates become {{name}}, common rq.* calls
 * become pm.*, tests become pm.test scripts).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/collections/[collectionId]/export">) {
  await connection();
  const { collectionId } = await ctx.params;
  const exported = exportCollection(collectionId);
  if (!exported) return notFound(`collection "${collectionId}"`);
  const postman = new URL(request.url).searchParams.get("format") === "postman";
  const name = `${fileName(exported.collection.name)}.${postman ? "postman_collection" : "reqora"}.json`;
  return new Response(JSON.stringify(postman ? exportPostman(exported) : exported, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
