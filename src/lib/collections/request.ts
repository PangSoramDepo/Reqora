import { renderJson, renderString, TemplateError, type TemplateContext } from "@/lib/workflows/template";
import { DEFAULT_USER_AGENT } from "@/lib/user-agent";
import type { Auth, Body, KeyValue, RequestDefinition, SentFile, SentFormPart } from "./schema";

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
  /** json / text bodies. */
  body?: string;
  /**
   * urlencoded / form-data fields. A file field carries only its file name (`src`); the bytes stay with the
   * saved request and are attached when the request is rendered.
   */
  form?: DraftFormField[];
  formMode?: "urlencoded" | "formdata";
  /** A binary body: the file's details (the bytes stay with the saved request). Read-only for scripts. */
  file?: { name: string; contentType: string; size: number };
};
export type DraftFormField = { key: string; value: string; type?: "text" | "file"; src?: string };

export function draftRequest(def: RequestDefinition, headers: KeyValue[] = def.headers): DraftRequest {
  const hasBody = def.method !== "GET" && def.method !== "HEAD";
  return {
    method: def.method,
    url: def.url,
    params: def.params.filter((p) => p.enabled && p.key.trim()).map(({ key, value }) => ({ key, value })),
    headers: headerRecord(headers, { type: "none" }),
    ...(hasBody ? bodyDraft(def.body) : {}),
  };
}

function bodyDraft(body: Body): Pick<DraftRequest, "body" | "form" | "formMode" | "file"> {
  switch (body.type) {
    case "binary":
      return body.data ? { file: { name: body.fileName, contentType: body.contentType, size: base64Size(body.data) } } : {};
    case "none":
      return {};
    case "json":
    case "text":
      return { body: body.text };
    case "urlencoded":
      return { formMode: "urlencoded", form: body.fields.filter((f) => f.enabled && f.key.trim()).map(({ key, value }) => ({ key, value })) };
    case "formdata":
      return {
        formMode: "formdata",
        form: body.fields
          .filter((f) => f.enabled && f.key.trim())
          .map((f) => (f.kind === "text" ? { key: f.key, value: f.value } : { key: f.key, value: "", type: "file" as const, src: f.fileName })),
      };
  }
}

export type PreparedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  /** A readable version of a multipart body (file contents left out). */
  bodyText?: string;
  form?: SentFormPart[];
  file?: SentFile;
};

/** Encodes fields as application/x-www-form-urlencoded (spaces as +, like browsers and Postman). */
export function urlEncodeForm(fields: { key: string; value: string }[]): string {
  return new URLSearchParams(fields.map((f) => [f.key, f.value])).toString();
}

export type MultipartPart = { key: string; value: string } | { key: string; fileName: string; contentType: string; data: Uint8Array };

/** Escapes a Content-Disposition parameter the way browsers do. */
const dispositionParam = (value: string) => value.replaceAll('"', "%22").replaceAll("\r", "%0D").replaceAll("\n", "%0A");

/** Builds a multipart/form-data body: the bytes, a readable version (file contents left out) and the boundary. */
export function encodeMultipart(parts: MultipartPart[], boundary = `----ReqoraBoundary${randomHex(12)}`) {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  let text = "";
  for (const part of parts) {
    const isFile = "data" in part;
    const head =
      `--${boundary}\r\nContent-Disposition: form-data; name="${dispositionParam(part.key)}"` +
      (isFile ? `; filename="${dispositionParam(part.fileName)}"\r\nContent-Type: ${part.contentType || "application/octet-stream"}` : "") +
      "\r\n\r\n";
    chunks.push(encoder.encode(head), isFile ? part.data : encoder.encode(part.value), encoder.encode("\r\n"));
    text += `${head}${isFile ? `<${part.data.byteLength} bytes from ${part.fileName}>` : part.value}\r\n`;
  }
  const tail = `--${boundary}--\r\n`;
  chunks.push(encoder.encode(tail));
  text += tail;
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return { bytes, text, boundary };
}

function randomHex(bytes: number): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Decoded size of base64 data. */
export const base64Size = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

export function fromBase64(data: string): Uint8Array {
  const binary = atob(data);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Renders every template in a draft and applies auth. Throws TemplateError for missing variables or invalid JSON. */
export function renderDraft(
  draft: DraftRequest,
  auth: Auth,
  /** The saved body: its type, and the files form-data fields refer to. */
  saved: Body,
  ctx: TemplateContext,
  baseUrl: string,
): PreparedRequest {
  const bodyType = saved.type;
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
  if (!hasHeader("user-agent")) headers["User-Agent"] = DEFAULT_USER_AGENT;

  const sendsBody = draft.method !== "GET" && draft.method !== "HEAD";
  if (sendsBody && bodyType === "binary" && draft.body === undefined) {
    if (saved.type !== "binary" || !saved.data) return { method: draft.method, url, headers };
    const bytes = fromBase64(saved.data);
    const contentType = saved.contentType || "application/octet-stream";
    if (!hasHeader("content-type")) headers["Content-Type"] = contentType;
    return {
      method: draft.method,
      url,
      headers,
      body: bytes as Uint8Array<ArrayBuffer>,
      bodyText: `<${bytes.byteLength} bytes from ${saved.fileName}>`,
      file: { fileName: saved.fileName, contentType, size: bytes.byteLength },
    };
  }
  const isForm = bodyType === "urlencoded" || bodyType === "formdata";
  if (sendsBody && isForm && draft.form !== undefined && draft.body === undefined) {
    const fields = draft.form.filter((f) => f.key.trim());
    if (bodyType === "urlencoded") {
      if (!hasHeader("content-type")) headers["Content-Type"] = "application/x-www-form-urlencoded";
      return { method: draft.method, url, headers, body: urlEncodeForm(fields.map((f) => ({ key: render(f.key), value: render(f.value) }))) };
    }
    const files = saved.type === "formdata" ? saved.fields : [];
    const parts: MultipartPart[] = fields.map((f) => {
      if (f.type !== "file") return { key: render(f.key), value: render(f.value) };
      const file = files.find((x) => x.kind === "file" && x.enabled && x.fileName === f.src && x.data);
      if (!file || file.kind !== "file") throw new TemplateError(`form-data field "${f.key}" has no file chosen`);
      return { key: render(f.key), fileName: file.fileName, contentType: file.contentType, data: fromBase64(file.data) };
    });
    const multipart = encodeMultipart(parts);
    // The boundary must match the body, so a hand-written Content-Type is replaced.
    for (const k of Object.keys(headers)) if (k.toLowerCase() === "content-type") delete headers[k];
    headers["Content-Type"] = `multipart/form-data; boundary=${multipart.boundary}`;
    return {
      method: draft.method,
      url,
      headers,
      body: multipart.bytes as Uint8Array<ArrayBuffer>,
      bodyText: multipart.text,
      form: parts.map((p) =>
        "data" in p
          ? { key: p.key, fileName: p.fileName, contentType: p.contentType || "application/octet-stream", size: p.data.byteLength }
          : { key: p.key, value: p.value },
      ),
    };
  }

  let body: string | undefined;
  if (sendsBody && draft.body !== undefined) {
    if (bodyType === "json") {
      body = draft.body.trim() === "" ? undefined : JSON.stringify(renderJson(draft.body, ctx));
      if (body !== undefined && !hasHeader("content-type")) headers["Content-Type"] = "application/json";
    } else {
      // Text, or a form body a script replaced with raw text.
      body = render(draft.body);
      if (!hasHeader("content-type")) headers["Content-Type"] = isForm && bodyType === "urlencoded" ? "application/x-www-form-urlencoded" : "text/plain";
    }
  }
  return { method: draft.method, url, headers, body };
}

/** Renders a definition on its own (no inherited settings, no scripts). */
export function prepareRequest(def: RequestDefinition, ctx: TemplateContext, baseUrl: string): PreparedRequest {
  return renderDraft(draftRequest(def), def.auth, def.body, ctx, baseUrl);
}

/** Switches a body to another format, carrying over what fits (text ↔ JSON, form fields ↔ form fields, a=b&c=d text ↔ fields). */
export function convertBody(body: Body, type: Body["type"]): Body {
  if (body.type === type) return body;
  const pairs: KeyValue[] =
    body.type === "urlencoded"
      ? body.fields
      : body.type === "formdata"
        ? body.fields.flatMap((f) => (f.kind === "text" ? [{ key: f.key, value: f.value, enabled: f.enabled }] : []))
        : body.type === "text" && /^[^\s=&{}[\]"]+=[^\s&]*(&[^\s=&]+=[^\s&]*)*$/.test(body.text.trim())
          ? body.text
              .trim()
              .split("&")
              .map((pair) => {
                const at = pair.indexOf("=");
                const decode = (s: string) => {
                  try {
                    return decodeURIComponent(s.replaceAll("+", " "));
                  } catch {
                    return s;
                  }
                };
                return { key: decode(pair.slice(0, at)), value: decode(pair.slice(at + 1)), enabled: true };
              })
          : [];
  switch (type) {
    case "none":
      return { type };
    case "binary":
      return { type, fileName: "", contentType: "", data: "" };
    case "json":
    case "text":
      return {
        type,
        text:
          body.type === "json" || body.type === "text"
            ? body.text
            : type === "text"
              ? pairs.filter((p) => p.enabled).map((p) => `${p.key}=${p.value}`).join("&")
              : "",
      };
    case "urlencoded":
      return { type, fields: pairs };
    case "formdata":
      return {
        type,
        fields: body.type === "formdata" ? body.fields : pairs.map((p) => ({ kind: "text" as const, ...p })),
      };
  }
}
