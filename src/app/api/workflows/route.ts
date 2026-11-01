import { connection } from "next/server";
import { parseBody, problem } from "@/lib/http";
import { validateGraph } from "@/lib/workflows/graph";
import { workflowInputSchema } from "@/lib/workflows/schema";
import { createWorkflow, listWorkflows } from "@/lib/workflows/store";

export async function GET() {
  // SQLite reads are synchronous, so opt out of prerendering explicitly.
  await connection();
  return Response.json({ data: listWorkflows() });
}

export async function POST(request: Request) {
  const parsed = await parseBody(request, workflowInputSchema);
  if ("error" in parsed) return parsed.error;

  const issues = validateGraph(parsed.data);
  if (issues.length) return problem(422, "Unprocessable Content", { detail: "invalid workflow graph", issues });

  const workflow = createWorkflow(parsed.data);
  return Response.json(workflow, { status: 201, headers: { Location: `/api/workflows/${workflow.id}` } });
}
