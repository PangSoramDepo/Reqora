import { connection, type NextRequest } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { validateGraph } from "@/lib/workflows/graph";
import { workflowInputSchema } from "@/lib/workflows/schema";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";
import { activeWorkspace } from "@/lib/workspaces/access";

/** The workflows of the active workspace. */
export async function GET(request: NextRequest) {
  // SQLite reads are synchronous, so opt out of prerendering explicitly.
  await connection();
  const access = activeWorkspace(request);
  if ("error" in access) return access.error;
  return Response.json({ data: listWorkflows(access.workspaceId) });
}

export async function POST(request: NextRequest) {
  const access = activeWorkspace(request, "editor");
  if ("error" in access) return access.error;
  const parsed = await parseBody(request, workflowInputSchema);
  if ("error" in parsed) return parsed.error;

  const issues = validateGraph(parsed.data);
  if (issues.length) return problem(422, "Unprocessable Content", { detail: "invalid workflow graph", issues });

  const workflow = createWorkflow(access.workspaceId, parsed.data);
  return Response.json(workflow, { status: 201, headers: { Location: `/api/workflows/${workflow.id}` } });
}
