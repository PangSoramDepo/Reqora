import { renderJson, renderString, type TemplateContext } from "@/lib/workflows/template";
import type { Auth, Body, KeyValue, RequestDefinition } from "./schema";

/** Appends enabled, non-empty-key params to a URL as a query string (keeps any query already present). */
export function buildUrl(url: string, params: KeyValue[]): string {
  const active = params.filter((p) => p.enabled && p.key.trim() !== "");
  if (active.length === 0) return url;
  const query = active.map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join("&");
  const hashAt = url.indexOf("#");
  const [base, hash] = hashAt === -1 ? [url, ""] : [url.slice(0, hashAt), url.slice(hashAt)];
  const sep = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?";
  return `${base}${sep}${query}${hash}`;
}

/** UTF-8 safe base64 (works in the browser and on the server). */
export function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** The header an auth setting produces, or undefined for `none` / `inherit` / incomplete settings. */
export function authHeader(auth: Auth): [string, string] | undefined {
  switch (auth.type) {
    case "inherit":
    case "none":
      return undefined;
    case "bearer":
      return auth.token ? ["Authorization", `Bearer ${auth.token}`] : undefined;
    case "basic":
      return auth.username || auth.password ? ["Authorization", `Basic ${base64(`${auth.username}:${auth.password}`)}`] : undefined;
    case "apiKey":
      return auth.header.trim() ? [auth.header.trim(), auth.value] : undefined;
  }
}

/** Enabled headers as a record (later duplicates win, case-insensitively), plus the auth header. */
export function headerRecord(headers: KeyValue[], auth: Auth, render: (s: string) => string = (s) => s): Record<string, string> {
  const out = new Map<string, [string, string]>();
  for (const h of headers) {
    if (!h.enabled || !h.key.trim()) continue;
    out.set(h.key.trim().toLowerCase(), [h.key.trim(), render(h.value)]);
  }
  const fromAuth = authHeader(auth);
  if (fromAuth) {
    // Basic auth must be encoded after rendering, so render the parts first.
    const rendered =
      auth.type === "basic"
        ? authHeader({ ...auth, username: render(auth.username), password: render(auth.password) })!
        : ([fromAuth[0], render(fromAuth[1])] as [string, string]);
    if (!out.has(rendered[0].toLowerCase())) out.set(rendered[0].toLowerCase(), rendered);
  }
  return Object.fromEntries(out.values());
}

/**
 * The request as pre-request scripts see it: templates not yet resolved (so a script can set variables the
 * templates then use), query params separate, and no auth header yet — auth is applied after the scripts
 * unless a script sets that header itself.
 */
export type DraftRequest = {
  method: string;
  url: string;
  params: { key: string; value: string }[];
  headers: Record<string, string>;
  body?: string;
};

export function draftRequest(def: RequestDefinition, headers: KeyValue[] = def.headers): DraftRequest {
  const hasBody = def.method !== "GET" && def.method !== "HEAD" && def.body.type !== "none";
  return {
    method: def.method,
    url: def.url,
    params: def.params.filter((p) => p.enabled && p.key.trim()).map(({ key, value }) => ({ key, value })),
    headers: headerRecord(headers, { type: "none" }),
    ...(hasBody && def.body.type !== "none" ? { body: def.body.text } : {}),
  };
}

export type PreparedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
};

/** Renders every template in a draft and applies auth. Throws TemplateError for missing variables or invalid JSON. */
export function renderDraft(
  draft: DraftRequest,
  auth: Auth,
  bodyType: Body["type"],
  ctx: TemplateContext,
  baseUrl: string,
): PreparedRequest {
  const render = (s: string) => renderString(s, ctx);
  const rawUrl = buildUrl(
    render(draft.url),
    draft.params.map((p) => ({ key: render(p.key), value: render(p.value), enabled: true })),
  );
  const url = new URL(rawUrl, baseUrl).toString();
  const headers = headerRecord(
    Object.entries(draft.headers).map(([key, value]) => ({ key, value, enabled: true })),
    auth,
    render,
  );
  const hasHeader = (name: string) => Object.keys(headers).some((k) => k.toLowerCase() === name);

  let body: string | undefined;
  if (draft.method !== "GET" && draft.method !== "HEAD" && draft.body !== undefined) {
    if (bodyType === "json") {
      body = draft.body.trim() === "" ? undefined : JSON.stringify(renderJson(draft.body, ctx));
      if (body !== undefined && !hasHeader("content-type")) headers["Content-Type"] = "application/json";
    } else {
      body = render(draft.body);
      if (!hasHeader("content-type")) headers["Content-Type"] = "text/plain";
    }
  }
  return { method: draft.method, url, headers, body };
}

/** Renders a definition on its own (no inherited settings, no scripts). */
export function prepareRequest(def: RequestDefinition, ctx: TemplateContext, baseUrl: string): PreparedRequest {
  return renderDraft(draftRequest(def), def.auth, def.body.type, ctx, baseUrl);
}
