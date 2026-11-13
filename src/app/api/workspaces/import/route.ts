import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseBody, problem } from "@/lib/http";
import { activeWorkspace } from "@/lib/workspaces/access";
import { selectWorkspace } from "@/lib/workspaces/cookie";
import { importWorkspace, parseWorkspaceExport, WorkspaceImportError } from "@/lib/workspaces/transfer";

const inputSchema = z.object({
  /** The `.reqora-workspace.json` file's text. */
  text: z.string().min(1).max(50_000_000),
  /** Name for the new workspace (default: the exported one's). */
  name: z.string().trim().min(1).max(80).optional(),
});

/**
 * Creates a new workspace, owned by the signed-in user, from a workspace export, and makes it the active one.
 * 201 with `{ workspaceId, counts, notes }` (notes: secrets to fill in, links that couldn't be restored).
 */
export async function POST(request: NextRequest) {
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, inputSchema);
  if ("error" in parsed) return parsed.error;
  let file;
  try {
    file = parseWorkspaceExport(parsed.data.text);
  } catch (error) {
    if (error instanceof WorkspaceImportError) return problem(422, "Unprocessable Content", { detail: error.message });
    throw error;
  }
  const result = importWorkspace(file, access.user.id, parsed.data.name);
  const response = NextResponse.json(result, { status: 201, headers: { Location: `/api/workspaces/${result.workspaceId}` } });
  selectWorkspace(response, request, result.workspaceId);
  return response;
}
