import "server-only";

import { resolveVariable } from "@/lib/secrets/variables";
import { scrub } from "@/lib/workflows/runner";
import type { Environment } from "@/lib/workflows/schema";
import { TemplateError, type TemplateContext } from "@/lib/workflows/template";
import { evaluateAssertions } from "./assertions";
import { prepareRequest } from "./request";
import type { RequestDefinition, SendOutcome } from "./schema";

const MAX_RESPONSE_BYTES = 1_000_000;
const ENV_PREFIX = "REQORA_ENV_";

class TooLarge extends Error {}

async function readCapped(response: Response): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TooLarge(`response body exceeds ${MAX_RESPONSE_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

type SendOptions = { environment: Environment; baseUrl: string; fetch?: typeof fetch };

/**
 * Sends a request definition from the server. `{{env.NAME}}` resolves like workflow runs (stored variable,
 * then `REQORA_ENV_NAME`); every resolved value of 6+ characters is scrubbed from the returned result so an
 * echoing upstream can't reveal secrets. Failures without an HTTP response come back as `{ error }`.
 */
export async function sendDefinition(def: RequestDefinition, { environment, baseUrl, fetch: doFetch = fetch }: SendOptions): Promise<SendOutcome> {
  const resolved = new Set<string>();
  const ctx: TemplateContext = {
    trigger: {},
    nodes: {},
    env: (name) => {
      const value = resolveVariable(environment, name) ?? process.env[`${ENV_PREFIX}${name}`];
      if (value === undefined) throw new TemplateError(`environment variable "${name}" is not configured in ${environment}`);
      if (value.length >= 6) resolved.add(value);
      return value;
    },
  };
  const secrets = () => [...resolved];

  let prepared;
  try {
    prepared = prepareRequest(def, ctx, baseUrl);
  } catch (error) {
    const message = error instanceof TypeError ? `invalid URL: ${error.message}` : (error as Error).message;
    return scrub({ error: message, durationMs: 0 }, secrets());
  }

  const started = Date.now();
  let response: Response;
  try {
    response = await doFetch(prepared.url, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
      redirect: def.settings.followRedirects ? "follow" : "manual",
      signal: AbortSignal.timeout(def.settings.timeoutMs),
    });
  } catch (error) {
    const err = error as Error & { cause?: { message?: string } };
    const reason =
      err.name === "TimeoutError" ? `timed out after ${def.settings.timeoutMs}ms` : (err.cause?.message ?? err.message);
    return scrub({ error: `request failed: ${reason}`, url: prepared.url, durationMs: Date.now() - started }, secrets());
  }

  let bytes: Uint8Array;
  try {
    bytes = await readCapped(response);
  } catch (error) {
    return scrub({ error: (error as Error).message, url: prepared.url, durationMs: Date.now() - started }, secrets());
  }
  const durationMs = Date.now() - started;
  const text = new TextDecoder().decode(bytes);
  const headers = Object.fromEntries(response.headers);
  let body: unknown = text;
  if (response.headers.get("content-type")?.includes("json") && text.trim() !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      // Mislabelled body: keep the text.
    }
  }

  const assertions = evaluateAssertions(def.assertions, { status: response.status, headers, body, bodyText: text, durationMs });
  return scrub(
    {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      size: bytes.byteLength,
      durationMs,
      url: prepared.url,
      assertions,
    },
    secrets(),
  );
}
