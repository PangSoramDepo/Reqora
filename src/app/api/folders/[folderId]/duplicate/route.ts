import type { NextRequest } from "next/server";
import { notFound } from "@/lib/http";
import { duplicateFolder, folderWorkspace } from "@/lib/collections/store";
import { accessTo } from "@/lib/workspaces/access";

/** Copies a folder with its settings and requests as "<name> Copy", right after the original. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/folders/[folderId]/duplicate">) {
  const { folderId } = await ctx.params;
  const access = accessTo(request, folderWorkspace(folderId), "editor", `folder "${folderId}"`);
  if ("error" in access) return access.error;
  const copy = duplicateFolder(folderId);
  if (!copy) return notFound(`folder "${folderId}"`);
  return Response.json(copy, { status: 201, headers: { Location: `/api/folders/${copy.id}` } });
}
