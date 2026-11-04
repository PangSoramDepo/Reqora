import "server-only";

import { resolveVariable } from "@/lib/secrets/variables";
import { scrub } from "@/lib/workflows/runner";
import type { Environment } from "@/lib/workflows/schema";
import { TemplateError, type TemplateContext } from "@/lib/workflows/template";
import { evaluateAssertions } from "./assertions";
import { resolveEffective } from "./inherit";
import { draftRequest, renderDraft } from "./request";
import type { RequestDefinition, ScopeSettings, ScriptReport, SendOutcome } from "./schema";
import { runScripts, type ScriptState } from "./scripts";

const MAX_RESPONSE_BYTES = 1_000_000;
const ENV_PREFIX = "REQORA_ENV_";
const SUPPORTED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

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

type Scope = { name: string; settings: ScopeSettings };
export type SendTarget = { name: string; definition: RequestDefinition; collection?: Scope; folder?: Scope };
type SendOptions = { environment: Environment; baseUrl: string; fetch?: typeof fetch };

const report = (state: ScriptState, errors: ScriptReport["errors"]): ScriptReport => ({
  logs: state.logs,
  tests: state.tests,
  errors,
  variables: state.variables,
});

/**
 * Sends a request from the server with Postman-style inheritance: collection → folder → request auth,
 * headers and scripts. Pre-request scripts see the unresolved request and may set `{{vars.NAME}}`;
 * templates resolve afterwards. `{{env.NAME}}` resolves like workflow runs (stored variable, then
 * `REQORA_ENV_NAME`), and every resolved value of 6+ characters is scrubbed from the whole result — logs
 * included — so neither an echoing upstream nor a script can reveal secrets. Failures without an HTTP
 * response come back as `{ error }`.
 */
export async function sendRequest(target: SendTarget, { environment, baseUrl, fetch: doFetch = fetch }: SendOptions): Promise<SendOutcome> {
  const def = target.definition;
  const resolved = new Set<string>();
  const readEnv = (name: string) => {
    const value = resolveVariable(environment, name) ?? process.env[`${ENV_PREFIX}${name}`];
    if (value !== undefined && value.length >= 6) resolved.add(value);
    return value;
  };
  const secrets = () => [...resolved];
  const effective = resolveEffective({ name: target.name, definition: def }, target.collection, target.folder);

  // 1. Pre-request scripts.
  let state: ScriptState = { request: draftRequest(def, effective.headers), variables: {}, logs: [], tests: [] };
  const pre = await runScripts({ phase: "pre", scripts: effective.preScripts, state, readEnv });
  state = pre.state;
  if (pre.errors.length) {
    const e = pre.errors[0];
    return scrub(
      { error: `pre-request script (${e.scope} “${e.source}”) failed: ${e.message}`, durationMs: 0, scripts: report(state, pre.errors) },
      secrets(),
    );
  }
  if (!SUPPORTED_METHODS.has(state.request.method)) {
    return scrub({ error: `unsupported method "${state.request.method}"`, durationMs: 0, scripts: report(state, []) }, secrets());
  }

  // 2. Resolve templates (env, vars from scripts, dynamic values) and apply auth.
  const ctx: TemplateContext = {
    trigger: {},
    nodes: { vars: state.variables },
    env: (name) => {
      const value = readEnv(name);
      if (value === undefined) throw new TemplateError(`environment variable "${name}" is not configured in ${environment}`);
      return value;
    },
  };
  let prepared;
  try {
    prepared = renderDraft(state.request, effective.auth, def.body.type, ctx, baseUrl);
  } catch (error) {
    const message = error instanceof TypeError ? `invalid URL: ${error.message}` : (error as Error).message;
    return scrub({ error: message, durationMs: 0, scripts: report(state, []) }, secrets());
  }

  // 3. Send.
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
    return scrub(
      { error: `request failed: ${reason}`, url: prepared.url, durationMs: Date.now() - started, scripts: report(state, []) },
      secrets(),
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readCapped(response);
  } catch (error) {
    return scrub(
      { error: (error as Error).message, url: prepared.url, durationMs: Date.now() - started, scripts: report(state, []) },
      secrets(),
    );
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

  // 4. Declarative assertions, then post-response scripts.
  const assertions = evaluateAssertions(def.assertions, { status: response.status, headers, body, bodyText: text, durationMs });
  const post = await runScripts({
    phase: "post",
    scripts: effective.postScripts,
    state,
    readEnv,
    response: { status: response.status, statusText: response.statusText, headers, body: text, responseTime: durationMs },
  });

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
      scripts: report(post.state, post.errors),
    },
    secrets(),
  );
}

/** Back-compat wrapper: a standalone definition with no collection or folder. */
export const sendDefinition = (def: RequestDefinition, options: SendOptions) =>
  sendRequest({ name: "request", definition: def }, options);
