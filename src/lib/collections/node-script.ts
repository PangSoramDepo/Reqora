import { logLines } from "./condition-script";
import type { ScriptDebug } from "./script-debug";
import { runScripts, type ScriptUser } from "./scripts";

/** A Script node's run: what it returned (`output`) or why it failed, its console output and environment changes. */
export type NodeScriptResult = ({ output: unknown } | { error: string }) & {
  logs?: string[];
  /** rq.environment.set / unset calls (null = unset), for the caller to save. */
  environment: Record<string, string | null>;
  /** rq.user.set / unset calls (null = unset), for the caller to save to the acting user. */
  user?: Record<string, string | null>;
  /** Debug runs: the script's recorded run. */
  debug?: ScriptDebug[];
};

// Reserved rq.variables keys used to pass the run context in and the return value out of the sandbox.
const CONTEXT_KEY = "__reqora_node_context__";
const RESULT_KEY = "__reqora_node_result__";
/** Lines wrapNodeScript adds before the code. */
const WRAPPER_LINES = 1;

/**
 * Wraps a Script node's code: `trigger` and `nodes` (earlier node outputs by id) are defined, and the return value
 * is handed back as JSON. The code runs as a function body, so `return` works anywhere.
 */
export function wrapNodeScript(code: string): string {
  // The prefix is one line (WRAPPER_LINES), so errors report the script's own line numbers.
  return `const { trigger, nodes } = JSON.parse(rq.variables.get(${JSON.stringify(CONTEXT_KEY)})); rq.variables.unset(${JSON.stringify(CONTEXT_KEY)}); const __result = await (async function () {
${code}
})();
rq.variables.set(${JSON.stringify(RESULT_KEY)}, JSON.stringify(__result === undefined ? null : __result));`;
}

/**
 * Runs a Script node's code in the script sandbox (rq / pm, lodash, moment…). `variables` is the run's shared
 * rq.variables bag, updated in place so later scripts and linked requests see what this one set. The output is
 * the returned value when it's an object, otherwise `{ value }`.
 */
export async function runNodeScript(
  code: string,
  context: { trigger: unknown; nodes: Record<string, unknown> },
  {
    readEnv,
    variables,
    user,
    readUser,
    debug = false,
  }: {
    readEnv: (name: string) => string | undefined;
    variables: Record<string, string>;
    user?: ScriptUser | null;
    readUser?: (name: string) => string | undefined;
    debug?: boolean;
  },
): Promise<NodeScriptResult> {
  const { state, errors, debug: traces } = await runScripts({
    phase: "post",
    debug,
    readEnv,
    user,
    readUser,
    state: {
      request: { method: "GET", url: "", params: [], headers: {} },
      variables: { ...variables, [CONTEXT_KEY]: JSON.stringify(context) },
      logs: [],
      tests: [],
      environment: {},
    },
    scripts: [{ scope: "request", name: "script node", code, wrap: wrapNodeScript, lineOffset: WRAPPER_LINES, locals: ["trigger", "nodes"] }],
  });
  const vars = { ...state.variables };
  const raw = vars[RESULT_KEY];
  delete vars[RESULT_KEY];
  delete vars[CONTEXT_KEY];
  for (const key of Object.keys(variables)) if (!(key in vars)) delete variables[key];
  Object.assign(variables, vars);

  const lines = logLines(state.logs);
  const extra = {
    environment: state.environment,
    ...(state.user ? { user: state.user } : {}),
    ...(lines.length ? { logs: lines } : {}),
    ...(traces?.length ? { debug: traces } : {}),
  };
  const failedTest = state.tests.find((t) => !t.passed);
  if (errors.length) return { error: `script failed: ${errors[0].message}`, ...extra };
  if (failedTest) return { error: `test "${failedTest.name}" failed: ${failedTest.error ?? "assertion failed"}`, ...extra };
  if (raw === undefined) return { error: "script did not finish", ...extra };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { error: "the script's return value isn't JSON (return an object, array, string, number or boolean)", ...extra };
  }
  const output = value !== null && typeof value === "object" && !Array.isArray(value) ? value : { value };
  return { output, ...extra };
}
