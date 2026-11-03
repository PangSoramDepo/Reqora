/** Only same-site relative paths; anything else (absolute or protocol-relative URLs) falls back to `/`. */
export function safeNext(value: string | null | undefined): string {
  // Browsers treat "/\host" like "//host", so both forms are rejected.
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}
