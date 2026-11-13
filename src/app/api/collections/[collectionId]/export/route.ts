import { connection, type NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { exportPostman } from "@/lib/collections/postman";
import { exportCollection, collectionWorkspace } from "@/lib/collections/store";
import { withoutExamples } from "@/lib/collections/secret-scan";
import { accessTo } from "@/lib/workspaces/access";

/** File-system-safe name: letters, digits, spaces, - and _ (the rest become -). */
const fileName = (name: string) => name.replace(/[^\w\- ]+/g, "-").trim().slice(0, 80) || "collection";

/**
 * Downloads the collection as a `.reqora.json` file (settings, folders, requests, scripts, examples) that
 * POST /api/collections/import with `format: "reqora"` turns back into a new collection.
 * `?format=postman` downloads a Postman Collection v2.1 instead (templates become {{name}}, common rq.* calls
 * become pm.*, tests become pm.test scripts). `?examples=0` leaves out saved example responses (they hold real
 * response data). GET …/export/check lists values that look like real credentials before exporting.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/collections/[collectionId]/export">) {
  await connection();
  const { collectionId } = await ctx.params;
  const access = accessTo(request, collectionWorkspace(collectionId), "viewer", `collection "${collectionId}"`);
  if ("error" in access) return access.error;
  const full = exportCollection(collectionId);
  if (!full) return notFound(`collection "${collectionId}"`);
  const params = new URL(request.url).searchParams;
  const exported = params.get("examples") === "0" ? withoutExamples(full) : full;
  const postman = params.get("format") === "postman";
  const name = `${fileName(exported.collection.name)}.${postman ? "postman_collection" : "reqora"}.json`;
  return new Response(JSON.stringify(postman ? exportPostman(exported) : exported, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "no-store",
    },
  });
}
