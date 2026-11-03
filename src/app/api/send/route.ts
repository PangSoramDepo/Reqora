import type { NextRequest } from "next/server";
import { parseBody } from "@/lib/http";
import { sendInputSchema } from "@/lib/collections/schema";
import { sendDefinition } from "@/lib/collections/send";

/** Sends an ad-hoc (possibly unsaved) definition. Upstream failures are a 200 with `{ error }`. */
export async function POST(request: NextRequest) {
  const parsed = await parseBody(request, sendInputSchema);
  if ("error" in parsed) return parsed.error;
  const { definition, environment } = parsed.data;
  return Response.json(await sendDefinition(definition, { environment, baseUrl: request.nextUrl.origin }));
}
