import { connection, type NextRequest } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { problem } from "@/lib/http";
import { listVariables } from "@/lib/secrets/variables";
import { environmentSchema } from "@/lib/workflows/schema";
import { allWorkflows } from "@/lib/workflows/store";
import { variableUsage } from "@/lib/workflows/usage";

/**
 * Variables for one environment, plus every `{{env.NAME}}` reference across workflow drafts —
 * including references to names that aren't set here (`missing`).
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/environments/[environment]/variables">) {
  await connection();
  const auth = requireUser(request);
  if ("error" in auth) return auth.error;
  const env = environmentSchema.safeParse((await ctx.params).environment);
  if (!env.success) return problem(404, "Not Found", { detail: "unknown environment" });

  const usage = variableUsage(allWorkflows());
  const variables = listVariables(env.data);
  const defined = new Set(variables.map((v) => v.name));

  return Response.json({
    environment: env.data,
    data: variables.map((v) => ({ ...v, usage: usage.get(v.name) ?? [] })),
    missing: [...usage.entries()]
      .filter(([name]) => !defined.has(name))
      .map(([name, refs]) => ({ name, usage: refs, fromServerEnv: process.env[`REQORA_ENV_${name}`] !== undefined })),
  });
}
