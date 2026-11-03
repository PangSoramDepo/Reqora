import type { NextRequest } from "next/server";
import { notFound, problem } from "@/lib/http";
import { sendDefinition } from "@/lib/collections/send";
import { getRequest } from "@/lib/collections/store";
import { environmentSchema } from "@/lib/workflows/schema";

/** Sends the request's saved definition. Upstream failures are a 200 with `{ error }` (see the API spec). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/requests/[requestId]/send">) {
  const { requestId } = await ctx.params;
  const environment = environmentSchema.safeParse(request.nextUrl.searchParams.get("environment") ?? "production");
  if (!environment.success) {
    return problem(400, "Bad Request", { detail: "environment must be production, staging or sandbox" });
  }
  const saved = getRequest(requestId);
  if (!saved) return notFound(`request "${requestId}"`);
  return Response.json(
    await sendDefinition(saved.definition, { environment: environment.data, baseUrl: request.nextUrl.origin }),
  );
}
