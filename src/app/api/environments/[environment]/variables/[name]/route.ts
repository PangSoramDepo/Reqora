import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { notFound, parseBody, problem } from "@/lib/http";
import { MissingKeyError } from "@/lib/secrets/crypto";
import { deleteVariable, listVariables, putVariable } from "@/lib/secrets/variables";
import { VARIABLE_NAME, environmentSchema, variableInputSchema } from "@/lib/workflows/schema";

type Ctx = RouteContext<"/api/environments/[environment]/variables/[name]">;

async function target(ctx: Ctx) {
  const { environment, name } = await ctx.params;
  const env = environmentSchema.safeParse(environment);
  if (!env.success) return { error: problem(404, "Not Found", { detail: "unknown environment" }) };
  if (!VARIABLE_NAME.test(name)) {
    return { error: problem(400, "Bad Request", { detail: "name must be UPPER_SNAKE_CASE (A-Z, 0-9, _), max 64 chars" }) };
  }
  return { environment: env.data, name };
}

/** Creates or replaces a variable. Secret values are encrypted at rest and never returned. */
export async function PUT(request: NextRequest, ctx: Ctx) {
  const auth = requireUser(request);
  if ("error" in auth) return auth.error;
  const t = await target(ctx);
  if ("error" in t) return t.error;
  const parsed = await parseBody(request, variableInputSchema);
  if ("error" in parsed) return parsed.error;

  let created: boolean;
  try {
    ({ created } = putVariable(t.environment, t.name, parsed.data));
  } catch (error) {
    if (error instanceof MissingKeyError) return problem(503, "Service Unavailable", { detail: error.message });
    throw error;
  }
  const variable = listVariables(t.environment).find((v) => v.name === t.name)!;
  return Response.json(variable, { status: created ? 201 : 200 });
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  const auth = requireUser(request);
  if ("error" in auth) return auth.error;
  const t = await target(ctx);
  if ("error" in t) return t.error;
  return deleteVariable(t.environment, t.name)
    ? new Response(null, { status: 204 })
    : notFound(`variable "${t.name}" in ${t.environment}`);
}
