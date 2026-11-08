import type { NodeType } from "./schema";

/** Something the user can do about a failed step. */
export type Fix =
  /** Opens the add-variable form for this name in the run's environment. */
  | { kind: "add-variable"; name: string }
  /** Opens the linked Collections request in the edit dialog. */
  | { kind: "edit-linked" }
  /** Unlinks the node from its (deleted or out-of-workspace) request, keeping its copy. */
  | { kind: "unlink" }
  /** Shows one of the HTTP node's inspector tabs. */
  | { kind: "tab"; tab: "Headers" | "Body (JSON)" | "Settings" }
  /** Focuses a field of the inspector by element id. */
  | { kind: "focus"; field: string }
  /** Opens a stored run in Execution History. */
  | { kind: "open-run"; runId: string }
  /** Opens another flow on the canvas. */
  | { kind: "open-flow"; workflowId: string };

export type Diagnosis = {
  /** A short, plain description of what went wrong. */
  title: string;
  /** What usually causes it, and what to check. */
  hint: string;
  fixes: { label: string; fix: Fix }[];
};

export type DiagnoseContext = {
  nodeType: NodeType;
  /** The node sends a linked Collections request. */
  linked?: boolean;
  /** The step's output (an HTTP response, a called flow's result…), when there is one. */
  output?: unknown;
  /** The run's environment label, e.g. "Sandbox". */
  environment?: string;
};

/** A message the upstream put in its error body (`message`, `error`, `detail`…), shortened. */
function upstreamMessage(output: unknown): string | undefined {
  const body = (output as { body?: unknown } | undefined)?.body;
  if (typeof body === "string") return body.trim() ? short(body) : undefined;
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ["message", "error_description", "detail", "error", "title", "msg"]) {
    const value = b[key];
    if (typeof value === "string" && value.trim()) return short(value);
    if (value && typeof value === "object" && typeof (value as { message?: unknown }).message === "string") {
      return short((value as { message: string }).message);
    }
  }
  return undefined;
}

const short = (text: string) => (text.length > 160 ? `${text.slice(0, 157)}…` : text);
const says = (output: unknown) => {
  const message = upstreamMessage(output);
  return message ? ` The API said: “${message}”.` : "";
};

/**
 * Turns a failed step's error into a plain explanation and the fixes that apply. Returns null for errors it
 * doesn't recognise (the raw error is still shown).
 */
export function diagnose(error: string, ctx: DiagnoseContext): Diagnosis | null {
  const env = ctx.environment ?? "this environment";
  const editRequest = (label: string) => ({ label, fix: { kind: "edit-linked" } as Fix });
  let m: RegExpMatchArray | null;

  if ((m = error.match(/environment variable "([^"]+)" is not configured/))) {
    const name = m[1];
    return {
      title: `${name} isn't set in ${env}`,
      hint: `{{env.${name}}} has no value in ${env}. Add it here (a secret stays encrypted), or switch the environment in the top bar if it's set elsewhere.`,
      fixes: [{ label: `Add ${name} to ${env}`, fix: { kind: "add-variable", name } }],
    };
  }

  if ((m = error.match(/upstream responded (\d{3})/))) {
    const status = Number(m[1]);
    const toRequest = (label: string, tab: "Headers" | "Body (JSON)") =>
      ctx.linked ? editRequest(label) : { label, fix: { kind: "tab", tab } as Fix };
    if (status === 401 || status === 403) {
      return {
        title: status === 401 ? "The API didn't accept the credentials (401)" : "The API refused access (403)",
        hint: `The token or API key is missing, wrong or expired in ${env}, or lacks permission.${says(ctx.output)} Check the Authorization header and the variable it uses.`,
        fixes: [toRequest(ctx.linked ? "Check the request's auth" : "Check headers", "Headers")],
      };
    }
    if (status === 404) {
      return {
        title: "The API couldn't find it (404)",
        hint: `The URL or an id in it is wrong, or the item doesn't exist in ${env}.${says(ctx.output)}`,
        fixes: [ctx.linked ? editRequest("Check the URL") : { label: "Check the URL", fix: { kind: "focus", field: "request-target" } }],
      };
    }
    if (status === 400 || status === 409 || status === 422) {
      return {
        title: `The API rejected the request (${status})`,
        hint: `Something in the body or parameters isn't what it expects.${says(ctx.output)} Compare the request sent (Execution History) with the API's docs.`,
        fixes: [toRequest("Check the body", "Body (JSON)")],
      };
    }
    if (status === 429) {
      return {
        title: "Too many requests (429)",
        hint: "The API is rate limiting. Slow down with a Delay node, or use “repeat until” with an interval to retry.",
        fixes: [],
      };
    }
    if (status >= 500) {
      return {
        title: `The API had an error (${status})`,
        hint: `The problem is on the server's side, not usually in your request.${says(ctx.output)} Try again later, or retry with “repeat until”.`,
        fixes: [],
      };
    }
    return { title: `The API answered ${status}`, hint: `Responses of 400 or more fail the step.${says(ctx.output)}`, fixes: [] };
  }

  if ((m = error.match(/request failed: timed out after (\d+)ms/))) {
    return {
      title: `No answer within ${Number(m[1]) / 1000}s`,
      hint: "The API was too slow or unreachable. Raise the timeout if it's just slow.",
      fixes: ctx.linked ? [] : [{ label: "Change the timeout", fix: { kind: "tab", tab: "Settings" } }],
    };
  }
  if ((m = error.match(/request failed: (blocked: .*)/))) {
    return { title: "Reqora blocked this address", hint: m[1].replace(/^blocked: /, ""), fixes: [] };
  }
  if ((m = error.match(/request failed: (.*)/))) {
    const reason = m[1];
    const dns = /ENOTFOUND|getaddrinfo/i.test(reason);
    return {
      title: dns ? "That host name doesn't exist" : "Couldn't connect to the server",
      hint: dns
        ? `Check the host in the URL, and the base-URL variable it uses in ${env}. (${reason})`
        : `The server isn't reachable from Reqora: is it running, and is the port right? (${reason})`,
      fixes: [ctx.linked ? editRequest("Check the URL") : { label: "Check the URL", fix: { kind: "focus", field: "request-target" } }],
    };
  }

  if (/linked Collections request was deleted/.test(error) || /linked Collections request is in another workspace/.test(error)) {
    return {
      title: "The linked request is gone",
      hint: "Unlink the node to keep running its last copy, or drop the request onto the canvas again.",
      fixes: [{ label: "Unlink and keep the copy", fix: { kind: "unlink" } }],
    };
  }
  if ((m = error.match(/^(\d+) tests? failed: (.*)/))) {
    return {
      title: `${m[1]} test${m[1] === "1" ? "" : "s"} failed`,
      hint: `Failed: ${m[2]}. The request's tests decide whether the step passes.`,
      fixes: ctx.linked ? [editRequest("Open the request's tests")] : [],
    };
  }
  if ((m = error.match(/^(pre-request|post-response) script \((\w+) “([^”]+)”\) failed: (.*)/))) {
    return {
      title: `The ${m[1]} script of ${m[2]} “${m[3]}” threw an error`,
      hint: m[4],
      fixes: ctx.linked ? [editRequest("Open the scripts")] : [],
    };
  }

  if (error === "pick the flow to call") {
    return { title: "No flow chosen", hint: "Choose the flow this node calls.", fixes: [{ label: "Choose a flow", fix: { kind: "focus", field: "call-flow" } }] };
  }
  if (error === "the called flow was deleted" || error === "the called flow is in another workspace") {
    return { title: "The called flow is gone", hint: "Choose another flow to call.", fixes: [{ label: "Choose a flow", fix: { kind: "focus", field: "call-flow" } }] };
  }
  if ((m = error.match(/^flow “(.+?)” failed: ([\s\S]*)/))) {
    const out = ctx.output as { runId?: string; workflowId?: string } | undefined;
    const fixes: Diagnosis["fixes"] = [];
    if (out?.runId) fixes.push({ label: "Open its run", fix: { kind: "open-run", runId: out.runId } });
    if (out?.workflowId) fixes.push({ label: `Open “${m[1]}”`, fix: { kind: "open-flow", workflowId: out.workflowId } });
    return { title: `The called flow “${m[1]}” failed`, hint: m[2], fixes };
  }
  if (/flows call each other in a loop/.test(error)) {
    return { title: "Flows call each other in a loop", hint: error.replace(/^.*?: /, "Chain: "), fixes: [] };
  }

  if ((m = error.match(/cannot compare non-numeric values with "([^"]+)": (.*) vs (.*)/))) {
    return {
      title: `“${m[1]}” needs numbers on both sides`,
      hint: `The values were ${m[2]} and ${m[3]}. A missing value (undefined) usually means the field path is wrong — pick it from the suggestions.`,
      fixes: ctx.nodeType === "condition" ? [{ label: "Check the left value", fix: { kind: "focus", field: "cond-left" } }] : [],
    };
  }
  if ((m = error.match(/invalid reference "(\{\{.*\}\})": (.*)/))) {
    return { title: `Can't read ${m[1]}`, hint: `${m[2]}. Type {{ in the field to pick a valid path.`, fixes: [] };
  }
  if ((m = error.match(/condition not met after (\d+) attempts: (.*)/))) {
    return {
      title: `Still not done after ${m[1]} attempts`,
      hint: `${m[2]}. Wait longer (more attempts or a longer interval), or check the value it compares.`,
      fixes: [],
    };
  }
  if (/response body exceeds/.test(error)) {
    return { title: "The response is too large", hint: "Responses over 1 MB aren't read. Ask the API for less (paging, filters).", fixes: [] };
  }
  return null;
}
