import { emptyDefinition, REQUEST_METHODS, type KeyValue, type RequestDefinition, type RequestMethod } from "./schema";

export class ImportError extends Error {}

/** Splits a shell command line into words: single/double quotes, backslash escapes, `\`/`^` line continuations. */
export function tokenize(input: string): string[] {
  const text = input.replace(/\\\r?\n/g, " ").replace(/\^\r?\n/g, " ");
  const words: string[] = [];
  let word = "";
  let inWord = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (inWord) words.push(word);
      word = "";
      inWord = false;
      i += 1;
      continue;
    }
    inWord = true;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end === -1) throw new ImportError("unterminated single quote");
      word += text.slice(i + 1, end);
      i = end + 1;
    } else if (c === "$" && text[i + 1] === "'") {
      // ANSI-C quoting: $'...' with backslash escapes.
      i += 2;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === "\\" && i + 1 < text.length) {
          const next = text[i + 1];
          word += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
          i += 2;
        } else {
          word += text[i];
          i += 1;
        }
      }
      if (i >= text.length) throw new ImportError("unterminated $'…' quote");
      i += 1;
    } else if (c === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) {
          word += text[i + 1];
          i += 2;
        } else {
          word += text[i];
          i += 1;
        }
      }
      if (i >= text.length) throw new ImportError("unterminated double quote");
      i += 1;
    } else if (c === "\\" && i + 1 < text.length) {
      word += text[i + 1];
      i += 2;
    } else {
      word += c;
      i += 1;
    }
  }
  if (inWord) words.push(word);
  return words;
}

const WITH_VALUE = new Set([
  "-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-ascii",
  "--data-urlencode", "--json", "-u", "--user", "--url", "-A", "--user-agent", "-b", "--cookie", "-e", "--referer",
  "-m", "--max-time", "-o", "--output", "--connect-timeout", "-x", "--proxy", "-w", "--write-out", "-F", "--form",
  "--cacert", "--cert", "--key", "-T", "--upload-file", "--retry", "-c", "--cookie-jar",
]);
const DATA = new Set(["-d", "--data", "--data-raw", "--data-binary", "--data-ascii", "--data-urlencode"]);

/** Splits `?a=1&b=2` off a URL into params (values decoded when possible). */
export function splitQuery(url: string): { url: string; params: KeyValue[] } {
  const q = url.indexOf("?");
  if (q === -1) return { url, params: [] };
  const hashAt = url.indexOf("#", q);
  const query = url.slice(q + 1, hashAt === -1 ? undefined : hashAt);
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s.replace(/\+/g, " "));
    } catch {
      return s;
    }
  };
  const params = query
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1
        ? { key: decode(pair), value: "", enabled: true }
        : { key: decode(pair.slice(0, eq)), value: decode(pair.slice(eq + 1)), enabled: true };
    });
  return { url: url.slice(0, q) + (hashAt === -1 ? "" : url.slice(hashAt)), params };
}

function isJson(text: string) {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

export function requestNameFor(method: string, url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  }
  return `${method} ${path || "/"}`.slice(0, 120);
}

/** Parses a `curl …` command into a request definition. */
export function parseCurl(command: string): { name: string; definition: RequestDefinition } {
  const words = tokenize(command.trim());
  if (words[0] !== "curl") throw new ImportError("command must start with curl");

  let method: string | undefined;
  let url: string | undefined;
  let json = false;
  let get = false;
  let user: string | undefined;
  let timeoutMs: number | undefined;
  const headers: KeyValue[] = [];
  const data: string[] = [];

  for (let i = 1; i < words.length; i += 1) {
    let flag = words[i];
    let value: string | undefined;

    if (flag.startsWith("--") && flag.includes("=")) {
      value = flag.slice(flag.indexOf("=") + 1);
      flag = flag.slice(0, flag.indexOf("="));
    } else if (/^-[A-Za-z]./.test(flag) && WITH_VALUE.has(flag.slice(0, 2))) {
      value = flag.slice(2); // attached short value: -XPOST, -H'X: y'
      flag = flag.slice(0, 2);
    }
    const takeValue = () => {
      if (value !== undefined) return value;
      i += 1;
      if (i >= words.length) throw new ImportError(`${flag} needs a value`);
      return words[i];
    };

    if (!flag.startsWith("-") || flag === "-") {
      url ??= flag;
      continue;
    }
    if (DATA.has(flag)) {
      data.push(takeValue());
    } else if (flag === "--json") {
      data.push(takeValue());
      json = true;
    } else if (flag === "-X" || flag === "--request") {
      method = takeValue().toUpperCase();
    } else if (flag === "-H" || flag === "--header") {
      const raw = takeValue();
      const colon = raw.indexOf(":");
      if (colon > 0) headers.push({ key: raw.slice(0, colon).trim(), value: raw.slice(colon + 1).trim(), enabled: true });
    } else if (flag === "-u" || flag === "--user") {
      user = takeValue();
    } else if (flag === "--url") {
      url = takeValue();
    } else if (flag === "-A" || flag === "--user-agent") {
      headers.push({ key: "User-Agent", value: takeValue(), enabled: true });
    } else if (flag === "-b" || flag === "--cookie") {
      headers.push({ key: "Cookie", value: takeValue(), enabled: true });
    } else if (flag === "-e" || flag === "--referer") {
      headers.push({ key: "Referer", value: takeValue(), enabled: true });
    } else if (flag === "-m" || flag === "--max-time") {
      const seconds = Number(takeValue());
      if (Number.isFinite(seconds)) timeoutMs = Math.min(30_000, Math.max(100, Math.round(seconds * 1000)));
    } else if (flag === "-I" || flag === "--head") {
      method ??= "HEAD";
    } else if (flag === "-G" || flag === "--get") {
      get = true;
    } else if (WITH_VALUE.has(flag)) {
      takeValue(); // recognised but irrelevant (output files, proxies, forms…)
    }
    // Other flags (-s, -L, -k, --compressed, -v…) don't change the request.
  }

  if (!url) throw new ImportError("no URL found in the cURL command");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url) && !url.startsWith("/") && !url.startsWith("{{")) url = `http://${url}`;

  const def = emptyDefinition();
  const split = splitQuery(url);
  def.url = split.url;
  def.params = split.params;

  if (get && data.length) {
    def.params.push(...splitQuery(`?${data.join("&")}`).params);
    data.length = 0;
  }

  const resolved = (method ?? (data.length ? "POST" : "GET")) as RequestMethod;
  if (!REQUEST_METHODS.includes(resolved)) throw new ImportError(`unsupported method ${resolved}`);
  def.method = resolved;

  const findHeader = (name: string) => headers.findIndex((h) => h.key.toLowerCase() === name);
  const authIdx = findHeader("authorization");
  if (authIdx !== -1 && /^bearer\s+/i.test(headers[authIdx].value)) {
    def.auth = { type: "bearer", token: headers[authIdx].value.replace(/^bearer\s+/i, "") };
    headers.splice(authIdx, 1);
  }
  if (user !== undefined) {
    const colon = user.indexOf(":");
    def.auth = colon === -1
      ? { type: "basic", username: user, password: "" }
      : { type: "basic", username: user.slice(0, colon), password: user.slice(colon + 1) };
  }

  if (data.length) {
    const text = data.join("&");
    const contentType = headers[findHeader("content-type")]?.value ?? "";
    if (json || contentType.includes("json") || (!contentType && isJson(text))) {
      def.body = { type: "json", text };
      if (json && findHeader("content-type") === -1) headers.push({ key: "Content-Type", value: "application/json", enabled: true });
      if (json && findHeader("accept") === -1) headers.push({ key: "Accept", value: "application/json", enabled: true });
    } else {
      def.body = { type: "text", text };
      if (!contentType) headers.push({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
    }
  }
  def.headers = headers;
  if (timeoutMs !== undefined) def.settings.timeoutMs = timeoutMs;

  return { name: requestNameFor(def.method, def.url), definition: def };
}
