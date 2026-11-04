import type { SyntaxNode, Tree } from "@lezer/common";
import { VARIABLE_NAME } from "@/lib/workflows/schema";
import {
  closest,
  inPhase,
  memberAt,
  membersAfter,
  UNAVAILABLE_GLOBALS,
  type ApiMember,
  type ScriptPhase,
} from "./script-api";

/**
 * Editor intelligence for pre-request / post-response scripts, over a @lezer/javascript syntax tree:
 * diagnostics (syntax errors, unknown rq members, sandbox pitfalls), completions and hover docs.
 * Pure functions so they run in tests without a DOM; the CodeMirror editor wires them up.
 */

export type Diagnostic = { from: number; to: number; severity: "error" | "warning"; message: string };
export type CompletionOption = { label: string; type: string; detail?: string; info?: string; boost?: number };
export type CompletionResult = { from: number; options: CompletionOption[] };
export type HoverInfo = { from: number; to: number; title: string; detail: string; doc: string };

const text = (code: string, n: SyntaxNode) => code.slice(n.from, n.to);

/**
 * The access path of an expression: `rq.environment.get` → ["rq", "environment", "get"],
 * `rq.expect(x).toBe` → ["rq", "expect", "()", "toBe"]. Null for anything else (computed access, literals…).
 */
export function pathOf(code: string, node: SyntaxNode | null): string[] | null {
  if (!node) return null;
  switch (node.name) {
    case "VariableName":
      return [text(code, node)];
    case "ParenthesizedExpression":
      return pathOf(code, node.firstChild?.nextSibling ?? null);
    case "MemberExpression": {
      const prop = node.lastChild;
      if (!prop || prop.name !== "PropertyName") return null;
      const base = pathOf(code, node.firstChild);
      return base && [...base, text(code, prop)];
    }
    case "CallExpression": {
      const base = pathOf(code, node.firstChild);
      return base && [...base, "()"];
    }
    default:
      return null;
  }
}

const display = (path: string[]) => path.join(".").replaceAll(".()", "()");

/** Names declared anywhere in the script (so `const fetch = …` doesn't warn). */
function declaredNames(code: string, tree: Tree): Set<string> {
  const names = new Set<string>();
  tree.iterate({
    enter: (n) => {
      if (n.name === "VariableDefinition") names.add(code.slice(n.from, n.to));
    },
  });
  return names;
}

/** The literal value of a string argument, or null when it isn't a plain literal. */
function literal(code: string, node: SyntaxNode): string | null {
  if (node.name === "String") return code.slice(node.from + 1, node.to - 1);
  if (node.name === "TemplateString" && !node.getChild("Interpolation")) return code.slice(node.from + 1, node.to - 1);
  return null;
}

/** First argument node of an ArgList (skipping punctuation), if any. */
function firstArg(args: SyntaxNode): SyntaxNode | null {
  for (let c = args.firstChild; c; c = c.nextSibling) {
    if (c.name !== "(" && c.name !== ")" && c.name !== ",") return c;
  }
  return null;
}

/** The engine's own parse error message (compiles without running), or null if the code is valid. */
function engineSyntaxError(code: string): string | null {
  try {
    // Compile only — the function is never called. Wrapped like the sandbox runs it, so top-level return works.
    new Function(code);
    return null;
  } catch (error) {
    return error instanceof SyntaxError ? error.message : null;
  }
}

export function lintScript(code: string, tree: Tree, phase: ScriptPhase): Diagnostic[] {
  const out: Diagnostic[] = [];
  const end = code.length;
  const span = (from: number, to: number) => ({ from: Math.min(from, end), to: Math.min(Math.max(to, from + 1), end) });

  // 1. Syntax. The JS engine decides whether there is an error (and words it); the parse tree says where.
  const engineError = engineSyntaxError(code);
  if (engineError) {
    let at: { from: number; to: number } | null = null;
    tree.iterate({
      enter: (n) => {
        if (at) return false;
        if (n.type.isError) at = span(n.from, n.to);
      },
    });
    // No error node (the engine is stricter, e.g. a duplicate `let`): mark the first line.
    const where = at ?? span(0, code.indexOf("\n") === -1 ? end : code.indexOf("\n"));
    out.push({ ...where, severity: "error", message: `Syntax error: ${engineError}` });
  }

  const declared = declaredNames(code, tree);

  tree.iterate({
    enter: (ref) => {
      const node = ref.node;

      // 2. Members of the rq / console API.
      if (node.name === "MemberExpression") {
        const prop = node.lastChild;
        if (!prop || prop.name !== "PropertyName") return;
        const objPath = pathOf(code, node.firstChild);
        if (!objPath || declared.has(objPath[0])) return;
        const members = membersAfter(objPath);
        if (!members) return;
        const name = text(code, prop);
        const member = members.find((m) => m.name === name);
        if (!member) {
          const hint = closest(name, members.filter((m) => inPhase(m, phase)).map((m) => m.name));
          out.push({
            ...span(prop.from, prop.to),
            severity: "error",
            message: `Property "${name}" does not exist on ${display(objPath)}.${hint ? ` Did you mean "${hint}"?` : ""}`,
          });
        } else if (!inPhase(member, phase)) {
          out.push({
            ...span(prop.from, prop.to),
            severity: "warning",
            message: `${display([...objPath, name])} is only available in post-response scripts; it is undefined here.`,
          });
        }
        return;
      }

      // 3. Environment name arguments.
      if (node.name === "CallExpression") {
        const calleePath = pathOf(code, node.firstChild);
        const callee = calleePath && !declared.has(calleePath[0]) ? memberAt(calleePath) : undefined;
        const args = node.getChild("ArgList");
        if (!callee?.envNameArg || !args) return;
        const arg = firstArg(args);
        const label = display(calleePath!);
        if (!arg) {
          out.push({ ...span(args.from, args.to), severity: "error", message: `${label}() needs a variable name.` });
          return;
        }
        const value = literal(code, arg);
        if (value === null) {
          if (callee.name === "get" || callee.name === "has") {
            out.push({
              ...span(arg.from, arg.to),
              severity: "warning",
              message: `Write the name as a string literal, e.g. ${label}("API_KEY"). Only names written literally are loaded into the script, so this returns undefined unless an earlier script set it.`,
            });
          }
        } else if (!VARIABLE_NAME.test(value)) {
          out.push({
            ...span(arg.from, arg.to),
            severity: "error",
            message: `"${value}" is not a valid environment variable name (letters, digits and _, starting with a letter or _; max 64).`,
          });
        }
        return;
      }

      // 4. Globals that don't exist in the sandbox (VariableName is always a reference, never a declaration).
      if (node.name === "VariableName") {
        const name = text(code, node);
        const reason = Object.hasOwn(UNAVAILABLE_GLOBALS, name) ? UNAVAILABLE_GLOBALS[name] : undefined;
        if (reason && !declared.has(name)) {
          out.push({ ...span(node.from, node.to), severity: "warning", message: `${name} is not available: ${reason}` });
        }
      }
    },
  });

  return out.sort((a, b) => a.from - b.from);
}

const TYPE: Record<ApiMember["kind"], string> = { namespace: "namespace", property: "property", method: "method" };

const option = (m: ApiMember, phase: ScriptPhase): CompletionOption => ({
  label: m.name,
  type: TYPE[m.kind],
  detail: m.detail,
  info: inPhase(m, phase) ? m.doc : `${m.doc} (Not available in ${phase === "pre" ? "pre-request" : "post-response"} scripts.)`,
  boost: inPhase(m, phase) ? 1 : -1,
});

/**
 * Completions at `pos`: rq/console members after a dot, environment names inside rq.environment.get("…"),
 * and the top-level API plus sandbox globals for a bare word. Null = nothing to add (CodeMirror's own
 * local-variable and keyword completions still apply).
 */
export function completeScript(
  code: string,
  tree: Tree,
  pos: number,
  phase: ScriptPhase,
  opts: { explicit?: boolean; envNames?: string[] } = {},
): CompletionResult | null {
  const node = tree.resolveInner(pos, -1);

  // Inside a string: environment names for rq.environment.get("|").
  if (node.name === "String" || node.name === "TemplateString") {
    const args = node.parent;
    const call = args?.name === "ArgList" ? args.parent : null;
    if (!call || call.name !== "CallExpression" || firstArg(args!)?.from !== node.from) return null;
    const callee = memberAt(pathOf(code, call.firstChild) ?? []);
    if (!callee?.envNameArg || !opts.envNames?.length) return null;
    return {
      from: node.from + 1,
      options: opts.envNames.map((name) => ({ label: name, type: "variable", detail: "environment variable" })),
    };
  }

  // After a dot: `rq.` / `rq.env|` / `rq.expect(x).to|`.
  let member: SyntaxNode | null = null;
  let from = pos;
  if ((node.name === "." || node.name === "?.") && node.parent?.name === "MemberExpression") {
    member = node.parent;
  } else if (node.name === "PropertyName" && node.parent?.name === "MemberExpression") {
    member = node.parent;
    from = node.from;
  }
  if (member) {
    const path = pathOf(code, member.firstChild);
    const members = path && membersAfter(path);
    if (!members) return null;
    return { from, options: members.map((m) => option(m, phase)) };
  }

  // A bare word (or Ctrl+Space on nothing): the API roots. Sandbox globals (JSON, Math…) come from the
  // editor's scope completion over SANDBOX_GLOBALS, which also completes their members.
  const word = node.name === "VariableName" ? node : null;
  if (!word && !opts.explicit) return null;
  return { from: word ? word.from : pos, options: membersAfter([])!.map((m) => ({ ...option(m, phase), boost: 2 })) };
}

/** Docs for the rq / console member under `pos`. */
export function hoverScript(code: string, tree: Tree, pos: number, side: -1 | 1 = 1): HoverInfo | null {
  const node = tree.resolveInner(pos, side);
  let path: string[] | null = null;
  if (node.name === "PropertyName" && node.parent?.name === "MemberExpression") path = pathOf(code, node.parent);
  else if (node.name === "VariableName") path = pathOf(code, node);
  if (!path || declaredNames(code, tree).has(path[0])) return null;
  const member = memberAt(path);
  if (!member) return null;
  return { from: node.from, to: node.to, title: display(path), detail: member.detail, doc: member.doc };
}
