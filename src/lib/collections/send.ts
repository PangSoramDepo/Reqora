import "server-only";

import { outboundFetch } from "@/lib/net/outbound";
import { resolveVariable, setVariableValue } from "@/lib/secrets/variables";
import { scrub } from "@/lib/workflows/runner";
import type { Environment } from "@/lib/workflows/schema";
import { TemplateError, type TemplateContext } from "@/lib/workflows/template";
import type { UserHandle } from "@/lib/users/schema";
import { evaluateAssertions } from "./assertions";
import { resolveEffective } from "./inherit";
import { draftRequest, renderDraft, type PreparedRequest } from "./request";
import type { RequestDefinition, ScopeSettings, ScriptReport, SendOutcome, SentRequest } from "./schema";
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
/** `folders`: the request's folder chain, outermost first. */
export type SendTarget = { name: string; definition: RequestDefinition; collection?: Scope; folders?: Scope[] };
type SendOptions = {
  /** Whose environment variables `{{env.NAME}}` reads (and rq.environment.set writes). */
  workspaceId: string;
  environment: Environment;
  baseUrl: string;
  fetch?: typeof fetch;
  /** Persists rq.environment.set / unset; defaults to the environment store. */
  writeEnv?: typeof setVariableValue;
  /** Receives the outcome before secrets are scrubbed (the send history keeps real values). */
  onUnscrubbed?: (outcome: SendOutcome) => void;
  /** Initial `rq.variables` (a workflow run carries them from one linked request to the next). */
  variables?: Record<string, string>;
  /** Workflow run context, so templates can also use `{{trigger.body.x}}` and `{{node-id.body.x}}`. */
  context?: Pick<TemplateContext, "trigger" | "nodes">;
  /** The test user the request is sent as: `{{user.NAME}}`, and rq.user (changes are saved to them). */
  user?: UserHandle;
  /** Record the scripts' runs (scripts.debug) for stepping through. */
  debug?: boolean;
};

const sent = (p: PreparedRequest): SentRequest => ({
  method: p.method,
  url: p.url,
  headers: { ...p.headers },
  ...(p.body === undefined ? {} : { body: typeof p.body === "string" ? p.body : (p.bodyText ?? "") }),
  ...(p.form ? { form: p.form.map((part) => ({ ...part })) } : {}),
  ...(p.file ? { file: { ...p.file } } : {}),
});

const report = (state: ScriptState, errors: ScriptReport["errors"]): ScriptReport => ({
  logs: state.logs,
  tests: state.tests,
  errors,
  variables: state.variables,
  environment: state.environment,
  ...(state.user && Object.keys(state.user).length ? { user: state.user } : {}),
});

/**
 * Sends a request from the server with Postman-style inheritance: collection → folder → request auth,
 * headers and scripts. Pre-request scripts see the unresolved request and may set `{{vars.NAME}}`;
 * templates resolve afterwards. `{{env.NAME}}` resolves like workflow runs (stored variable, then
 * `REQORA_ENV_NAME`), and every resolved value of 6+ characters is scrubbed from the whole result — logs
 * included — so neither an echoing upstream nor a script can reveal secrets. Failures without an HTTP
 * response come back as `{ error }`.
 */
export async function sendRequest(
  target: SendTarget,
  {
    workspaceId,
    environment,
    baseUrl,
    fetch: doFetch = outboundFetch(baseUrl),
    writeEnv = setVariableValue,
    onUnscrubbed,
    variables = {},
    context,
    user,
    debug = false,
  }: SendOptions,
): Promise<SendOutcome> {
  const def = target.definition;
  const resolved = new Set<string>();
  const readUser = (name: string) => {
    const value = user?.get(name);
    if (value !== undefined && value.length >= 6) resolved.add(value);
    return value;
  };
  const scriptUser = user ? { name: user.name, roles: user.roles, role: user.role } : null;
  const readEnv = (name: string) => {
    const value = resolveVariable(workspaceId, environment, name) ?? process.env[`${ENV_PREFIX}${name}`];
    if (value !== undefined && value.length >= 6) resolved.add(value);
    return value;
  };
  const secrets = () => [...resolved];

  /** Debug sends: the scripts' recorded runs so far (pre-request, then post-response). */
  const traces: NonNullable<ScriptReport["debug"]> = [];
  /** Saves the scripts' environment changes, then scrubs. Every return goes through here exactly once. */
  const finish = <T extends SendOutcome>(outcome: T): T => {
    if (debug && outcome.scripts) outcome.scripts.debug = traces;
    for (const [name, value] of Object.entries(outcome.scripts?.environment ?? {})) {
      try {
        const { kind } = writeEnv(workspaceId, environment, name, value);
        if (kind === "secret" && value !== null && value.length >= 6) resolved.add(value);
      } catch (error) {
        outcome.scripts?.errors.push({
          phase: "post",
          scope: "request",
          source: target.name,
          message: `could not save environment variable "${name}": ${(error as Error).message}`,
        });
      }
    }
    for (const [name, value] of Object.entries(outcome.scripts?.user ?? {})) {
      try {
        user?.set(name, value);
        if (value !== null && value.length >= 6) resolved.add(value);
      } catch (error) {
        outcome.scripts?.errors.push({
          phase: "post",
          scope: "request",
          source: target.name,
          message: `could not save "${name}" to test user “${user?.name}”: ${(error as Error).message}`,
        });
      }
    }
    onUnscrubbed?.(outcome);
    return scrub(outcome, secrets());
  };
  const effective = resolveEffective({ name: target.name, definition: def }, target.collection, target.folders);

  // 1. Pre-request scripts.
  let state: ScriptState = {
    request: draftRequest(def, effective.headers),
    variables: { ...variables },
    logs: [],
    tests: [],
    environment: {},
  };
  const pre = await runScripts({ phase: "pre", scripts: effective.preScripts, state, readEnv, user: scriptUser, readUser, debug });
  state = pre.state;
  traces.push(...(pre.debug ?? []));
  if (pre.errors.length) {
    const e = pre.errors[0];
    return finish(
      { error: `pre-request script (${e.scope} “${e.source}”) failed: ${e.message}`, durationMs: 0, scripts: report(state, pre.errors) },
    );
  }
  if (!SUPPORTED_METHODS.has(state.request.method)) {
    return finish({ error: `unsupported method "${state.request.method}"`, durationMs: 0, scripts: report(state, []) });
  }

  // 2. Resolve templates (env, vars from scripts, dynamic values) and apply auth.
  const ctx: TemplateContext = {
    trigger: context?.trigger ?? {},
    nodes: { ...context?.nodes, vars: state.variables },
    env: (name) => {
      const changed = state.environment[name];
      const value = changed === null ? undefined : (changed ?? readEnv(name));
      if (value === undefined) throw new TemplateError(`environment variable "${name}" is not configured in ${environment}`);
      return value;
    },
    ...(user
      ? {
          user: (name: string) => {
            const changed = state.user?.[name];
            const value = changed === null ? undefined : (changed ?? readUser(name));
            if (value === undefined) throw new TemplateError(`test user “${user.name}” has no "${name}" in ${environment}`);
            return value;
          },
        }
      : {}),
  };
  let prepared;
  try {
    prepared = renderDraft(state.request, effective.auth, def.body, ctx, baseUrl);
  } catch (error) {
    const message = error instanceof TypeError ? `invalid URL: ${error.message}` : (error as Error).message;
    return finish({ error: message, durationMs: 0, scripts: report(state, []) });
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
    return finish(
      { error: `request failed: ${reason}`, url: prepared.url, request: sent(prepared), durationMs: Date.now() - started, scripts: report(state, []) },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readCapped(response);
  } catch (error) {
    return finish(
      { error: (error as Error).message, url: prepared.url, request: sent(prepared), durationMs: Date.now() - started, scripts: report(state, []) },
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
    user: scriptUser,
    readUser,
    debug,
    response: { status: response.status, statusText: response.statusText, headers, body: text, responseTime: durationMs },
  });

  traces.push(...(post.debug ?? []));
  return finish(
    {
      status: response.status,
      statusText: response.statusText,
      headers,
      body,
      size: bytes.byteLength,
      durationMs,
      url: prepared.url,
      request: sent(prepared),
      assertions,
      scripts: report(post.state, post.errors),
    },
  );
}

/** Back-compat wrapper: a standalone definition with no collection or folder. */
export const sendDefinition = (def: RequestDefinition, options: SendOptions) =>
  sendRequest({ name: "request", definition: def }, options);
