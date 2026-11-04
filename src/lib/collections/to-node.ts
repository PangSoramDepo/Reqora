import { newNode } from "@/lib/workflows/defaults";
import type { Workflow, WorkflowNode } from "@/lib/workflows/schema";
import type { EffectiveRequest } from "./inherit";
import { buildUrl, headerRecord } from "./request";
import type { RequestDefinition } from "./schema";

type HttpNode = Extract<WorkflowNode, { type: "http" }>;
export type HttpNodeDraft = { name: string; config: HttpNode["config"]; warnings: string[] };
const NODE_SPACING_X = 280;

/**
 * Converts a request into a workflow `http` node config, applying inherited auth and headers when given.
 * Returns an error for things workflow nodes can't express (HEAD/OPTIONS, text bodies, templated basic auth);
 * scripts and assertions are dropped with a warning because workflow nodes don't run them.
 */
export function requestToHttpConfig(
  name: string,
  def: RequestDefinition,
  effective?: Pick<EffectiveRequest, "auth" | "headers" | "preScripts" | "postScripts">,
): { ok: true; draft: HttpNodeDraft } | { ok: false; error: string } {
  const auth = effective?.auth ?? (def.auth.type === "inherit" ? { type: "none" as const } : def.auth);
  const headers = effective?.headers ?? def.headers;

  if (def.method === "HEAD" || def.method === "OPTIONS") {
    return { ok: false, error: `Workflow HTTP nodes support GET, POST, PUT, PATCH and DELETE — change the method from ${def.method} first.` };
  }
  if (!def.url.trim()) return { ok: false, error: "The request has no URL." };
  if (def.body.type === "text" && def.method !== "GET" && def.body.text.trim()) {
    return { ok: false, error: "Workflow HTTP nodes send JSON bodies only — switch the body to JSON or clear it." };
  }
  if (auth.type === "basic" && `${auth.username}${auth.password}`.includes("{{")) {
    return {
      ok: false,
      error: "Basic auth with {{templates}} can't be pre-encoded for a workflow node; add an Authorization header instead.",
    };
  }

  const warnings: string[] = [];
  const scripts = effective ? effective.preScripts.length + effective.postScripts.length : (def.preScript.trim() ? 1 : 0) + (def.postScript.trim() ? 1 : 0);
  if (scripts) warnings.push("Pre-request and post-response scripts don't run in workflows, so they were left out.");
  if (def.assertions.length) warnings.push("Tests were left out — workflow steps fail on 4xx/5xx responses instead.");
  if (`${def.url}${def.body.type === "none" ? "" : def.body.text}`.includes("{{vars.")) {
    warnings.push("{{vars.*}} values come from scripts and won't resolve in a workflow.");
  }

  const body = def.body.type === "json" && def.method !== "GET" && def.body.text.trim() ? def.body.text : undefined;
  return {
    ok: true,
    draft: {
      name: name.trim().slice(0, 120) || "Send HTTP",
      config: {
        method: def.method,
        url: buildUrl(def.url, def.params).slice(0, 2000),
        headers: headerRecord(headers, auth),
        ...(body === undefined ? {} : { body }),
        timeoutMs: def.settings.timeoutMs,
      },
      warnings,
    },
  };
}

/** Places a converted node right of the workflow's rightmost node (or at `position` when given). */
export function draftToNode(
  draft: HttpNodeDraft,
  workflow: Pick<Workflow, "nodes">,
  position?: { x: number; y: number },
): HttpNode {
  const rightmost = workflow.nodes.reduce<WorkflowNode | undefined>((best, n) => (!best || n.position.x > best.position.x ? n : best), undefined);
  const at = position ?? (rightmost ? { x: rightmost.position.x + NODE_SPACING_X, y: rightmost.position.y } : { x: 80, y: 120 });
  const base = newNode("http", at, workflow.nodes.map((n) => n.id)) as HttpNode;
  return { ...base, name: draft.name, config: draft.config };
}

/** Converts a standalone request (no inherited settings) straight into a positioned node. */
export function requestToNode(
  name: string,
  def: RequestDefinition,
  workflow: Pick<Workflow, "nodes">,
): { ok: true; node: HttpNode } | { ok: false; error: string } {
  const converted = requestToHttpConfig(name, def);
  return converted.ok ? { ok: true, node: draftToNode(converted.draft, workflow) } : converted;
}
