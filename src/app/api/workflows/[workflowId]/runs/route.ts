import { connection, type NextRequest } from "next/server";
import { notFound, parseBody, problem } from "@/lib/http";
import { runWorkflow } from "@/lib/workflows/runner";
import { runInputSchema } from "@/lib/workflows/schema";
import { getWorkflow, listRuns, workflowWorkspace } from "@/lib/workflows/store";
import { accessTo } from "@/lib/workspaces/access";

type Ctx = RouteContext<"/api/workflows/[workflowId]/runs">;

export async function GET(request: NextRequest, ctx: Ctx) {
  await connection();
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "viewer", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;

  const raw = request.nextUrl.searchParams.get("limit") ?? "20";
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return problem(400, "Bad Request", { detail: "limit must be an integer between 1 and 100" });
  }
  return Response.json({ data: listRuns(workflowId, limit) });
}

export async function POST(request: NextRequest, ctx: Ctx) {
  const { workflowId } = await ctx.params;
  const access = accessTo(request, workflowWorkspace(workflowId), "editor", `workflow "${workflowId}"`);
  if ("error" in access) return access.error;
  const workflow = getWorkflow(workflowId);
  if (!workflow) return notFound(`workflow "${workflowId}"`);

  const parsed = await parseBody(request, runInputSchema, { allowEmpty: true });
  if ("error" in parsed) return parsed.error;

  const { environment, trigger } = parsed.data;
  const options = { baseUrl: request.nextUrl.origin, environment };
  // Manual runs execute the draft, so changes can be tested before they are deployed.
  if (!request.headers.get("accept")?.includes("application/x-ndjson")) {
    const { run } = await runWorkflow(workflow, { source: "manual", ...trigger }, options);
    return Response.json(run, { status: 201, headers: { Location: `/api/runs/${run.id}` } });
  }

  // Streaming: one JSON object per line as the run progresses — {"type":"node","nodeId"} when a node starts,
  // {"type":"step","step"} when it finishes or is skipped, then {"type":"run","run"} (or {"type":"error"}).
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}
`));
      try {
        const { run } = await runWorkflow(workflow, { source: "manual", ...trigger }, { ...options, onProgress: send });
        send({ type: "run", run });
      } catch (error) {
        send({ type: "error", message: (error as Error).message });
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 201,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
