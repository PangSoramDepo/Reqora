import type { ScriptDebug } from "./script-debug";
import { runScripts, type ScriptLog, type ScriptResponse, type ScriptUser } from "./scripts";

/** `logs`: the script's console output for this check. */
export type ConditionResult = ({ met: true } | { met: false } | { error: string }) & { logs?: string[]; debug?: ScriptDebug[] };

const TEST_NAME = "__repeat_until__";
const MAX_LOG_LINES = 20;
const MAX_LOG_CHARS = 2000;
const NOT_MET = "__condition_not_met__";
/** Lines wrapCondition adds before the condition. */
const WRAPPER_LINES = 1;

/** Script console output as display lines (most recent 20, each capped), e.g. "[warn] retrying". */
export function logLines(logs: Pick<ScriptLog, "level" | "message">[]): string[] {
  return logs
    .map((l) => (l.level === "log" ? l.message : `[${l.level}] ${l.message}`))
    .slice(-MAX_LOG_LINES)
    .map((l) => (l.length > MAX_LOG_CHARS ? `${l.slice(0, MAX_LOG_CHARS)}…` : l));
}

/**
 * Wraps a condition so it runs like a post-response script. A plain expression is returned as is; code with a
 * `return` statement is used as a function body. `response.body` is the parsed JSON (or text).
 */
export function wrapCondition(code: string): string {
  return wrapConditionBody(conditionBody(code));
}

/** The condition as a function body: a plain expression becomes `return (…)`, on the same lines. */
function conditionBody(code: string): string {
  const trimmed = code.trim().replace(/;+\s*$/, "");
  return /(^|[^\w$.])return\b/.test(trimmed) ? trimmed : `return (${trimmed}\n);`;
}

function wrapConditionBody(body: string): string {
  // The wrapper's prefix is one line (WRAPPER_LINES), so errors report the condition's own line numbers.
  return `const response = { status: rq.response.status, headers: rq.response.headers, body: (() => { try { return rq.response.json(); } catch (e) { return rq.response.text(); } })() }; const __met = await (async function () {
${body}
})();
rq.test(${JSON.stringify(TEST_NAME)}, () => { if (!__met) throw new Error(${JSON.stringify(NOT_MET)}); });`;
}

/**
 * Evaluates a "repeat until" script condition against a node's response in the script sandbox (rq / pm, lodash,
 * moment…). Truthy = met. Environment changes made by the condition aren't saved.
 */
export async function checkConditionScript(
  code: string,
  output: unknown,
  {
    readEnv,
    variables = {},
    user,
    readUser,
    debug = false,
  }: {
    readEnv: (name: string) => string | undefined;
    variables?: Record<string, string>;
    /** Record the script's run for stepping through. */
    debug?: boolean;
    /** The acting test user (read-only here: rq.user.set changes aren't saved by a condition). */
    user?: ScriptUser | null;
    readUser?: (name: string) => string | undefined;
  },
): Promise<ConditionResult> {
  if (!code.trim()) return { error: '"repeat until" script is empty' };
  const out = (output ?? {}) as { status?: number; headers?: Record<string, string>; body?: unknown; durationMs?: number };
  const response: ScriptResponse = {
    status: out.status ?? 0,
    statusText: "",
    headers: out.headers ?? {},
    body: typeof out.body === "string" ? out.body : JSON.stringify(out.body ?? null),
    responseTime: out.durationMs ?? 0,
  };
  const { state, errors, debug: traces } = await runScripts({
    phase: "post",
    debug,
    readEnv,
    user,
    readUser,
    response,
    state: { request: { method: "GET", url: "", params: [], headers: {} }, variables: { ...variables }, logs: [], tests: [], environment: {} },
    scripts: [
      { scope: "request", name: "repeat until", code: conditionBody(code), wrap: wrapConditionBody, lineOffset: WRAPPER_LINES, locals: ["response"], shown: code.trim() },
    ],
  });
  const lines = logLines(state.logs);
  const logs = { ...(lines.length ? { logs: lines } : {}), ...(traces?.length ? { debug: traces } : {}) };
  if (errors.length) return { error: `"repeat until" script failed: ${errors[0].message}`, ...logs };
  const test = state.tests.find((t) => t.name === TEST_NAME);
  if (!test) return { error: '"repeat until" script did not run', ...logs };
  if (test.passed) return { met: true, ...logs };
  if (test.error?.includes(NOT_MET)) return { met: false, ...logs };
  return { error: `"repeat until" script threw: ${test.error ?? "unknown error"}`, ...logs };
}
