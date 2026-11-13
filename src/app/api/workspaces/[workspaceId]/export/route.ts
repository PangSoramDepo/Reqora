import { connection, type NextRequest } from "next/server";
import { accessTo } from "@/lib/workspaces/access";
import { workspaceExists, workspaceOf } from "@/lib/workspaces/store";
import { withoutExamples } from "@/lib/collections/secret-scan";
import { exportWorkspace } from "@/lib/workspaces/transfer";

/** File-system-safe name: letters, digits, spaces, - and _ (the rest become -). */
const fileName = (name: string) => name.replace(/[^\w\- ]+/g, "-").trim().slice(0, 80) || "workspace";

/**
 * Downloads the workspace as a `.reqora-workspace.json` file (collections, flows, and per environment its
 * variables and test users — secret values left out) that POST /api/workspaces/import turns into a new workspace.
 * Editors and owners only. `?check=1` returns `{ findings, summary }` instead: values that look like real
 * credentials typed into requests, examples or flows (masked), and what the file will hold. `?examples=0` leaves
 * out saved example responses.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/workspaces/[workspaceId]/export">) {
  await connection();
  const { workspaceId } = await ctx.params;
  const access = accessTo(request, workspaceExists(workspaceId) ? workspaceId : undefined, "editor", `workspace "${workspaceId}"`);
  if ("error" in access) return access.error;
  const name = workspaceOf(access.user.id, workspaceId)?.name ?? "Workspace";
  const { file, findings } = exportWorkspace(workspaceId, name);
  if (new URL(request.url).searchParams.get("check") === "1") {
    const envs = Object.values(file.environments);
    const variables = envs.flatMap((e) => e?.variables ?? []);
    return Response.json({
      findings,
      summary: {
        collections: file.collections.length,
        flows: file.flows.length,
        plainVariables: variables.filter((v) => v.kind === "plain").length,
        secretVariables: variables.filter((v) => v.kind === "secret").length,
        testUsers: envs.reduce((n, e) => n + (e?.testUsers?.users.length ?? 0), 0),
      },
    });
  }
  if (new URL(request.url).searchParams.get("examples") === "0") {
    file.collections = file.collections.map((collection) => withoutExamples({ reqora: "collection", version: 1, collection }).collection);
  }
  const download = `${fileName(name)}.reqora-workspace.json`;
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${download}"; filename*=UTF-8''${encodeURIComponent(download)}`,
      "cache-control": "no-store",
    },
  });
}
