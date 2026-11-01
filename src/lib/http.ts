import type { z } from "zod";

type Issue = { path: string; message: string };

/** RFC 9457 problem details response. */
export function problem(status: number, title: string, extra: { detail?: string; issues?: Issue[] } = {}) {
  return Response.json(
    { type: "about:blank", title, status, ...extra },
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

export const notFound = (what: string) => problem(404, "Not Found", { detail: `${what} not found` });

/**
 * Parses and validates a JSON body. Returns the data, or a 400 problem response to send back.
 * An empty body is treated as `{}` when `allowEmpty` is set.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  { allowEmpty = false } = {},
): Promise<{ data: z.output<T> } | { error: Response }> {
  const text = await request.text();
  let json: unknown = {};
  if (text.trim() !== "" || !allowEmpty) {
    try {
      json = JSON.parse(text);
    } catch {
      return { error: problem(400, "Bad Request", { detail: "request body must be valid JSON" }) };
    }
  }

  const result = schema.safeParse(json);
  if (!result.success) {
    return {
      error: problem(400, "Bad Request", {
        detail: "request body failed validation",
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
    };
  }
  return { data: result.data };
}
