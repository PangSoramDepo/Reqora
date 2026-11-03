import type { Assertion, AssertionResult } from "./schema";

export type AssertionInput = {
  status: number;
  headers: Record<string, string>;
  /** Parsed JSON when the response was JSON, otherwise the text. */
  body: unknown;
  bodyText: string;
  durationMs: number;
};

/** Resolves a dot path like `customer.id`, `items.0.sku`, `$.items[0].sku`. */
export function getPath(value: unknown, path: string): { found: boolean; value?: unknown } {
  const parts = path
    .trim()
    .replace(/^\$\.?/, "")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter((p) => p !== "");
  let current = value;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return { found: false };
    if (!Object.prototype.hasOwnProperty.call(current, part)) return { found: false };
    current = (current as Record<string, unknown>)[part];
  }
  return { found: true, value: current };
}

const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** `"42"` equals 42, `"true"` equals true; objects compare by their JSON. */
function looseEquals(actual: unknown, expected: string): boolean {
  if (typeof actual === "string") return actual === expected;
  if (typeof actual === "number") return expected.trim() !== "" && Number(expected) === actual;
  if (typeof actual === "boolean" || actual === null) return String(actual) === expected.trim();
  try {
    return JSON.stringify(actual) === JSON.stringify(JSON.parse(expected));
  } catch {
    return false;
  }
}

export function evaluateAssertion(assertion: Assertion, res: AssertionInput): AssertionResult {
  switch (assertion.type) {
    case "status":
      return { assertion, passed: res.status === assertion.equals, actual: String(res.status) };
    case "responseTimeBelow":
      return { assertion, passed: res.durationMs < assertion.ms, actual: `${res.durationMs}ms` };
    case "headerContains": {
      const entry = Object.entries(res.headers).find(([k]) => k.toLowerCase() === assertion.header.toLowerCase());
      return entry
        ? { assertion, passed: entry[1].includes(assertion.value), actual: entry[1] }
        : { assertion, passed: false, actual: "(header missing)" };
    }
    case "bodyContains":
      return { assertion, passed: res.bodyText.includes(assertion.text) };
    case "jsonPathEquals": {
      const hit = getPath(res.body, assertion.path);
      return hit.found
        ? { assertion, passed: looseEquals(hit.value, assertion.value), actual: show(hit.value) }
        : { assertion, passed: false, actual: "(path not found)" };
    }
    case "jsonPathExists": {
      const hit = getPath(res.body, assertion.path);
      return { assertion, passed: hit.found, actual: hit.found ? show(hit.value) : "(path not found)" };
    }
  }
}

export const evaluateAssertions = (assertions: Assertion[], res: AssertionInput) =>
  assertions.map((a) => evaluateAssertion(a, res));

/** Human label, e.g. `Status is 201`, `$.customer.id == "x"`. */
export function describeAssertion(a: Assertion): string {
  switch (a.type) {
    case "status":
      return `Status code is ${a.equals}`;
    case "responseTimeBelow":
      return `Response time < ${a.ms}ms`;
    case "headerContains":
      return `Header ${a.header} contains "${a.value}"`;
    case "bodyContains":
      return `Body contains "${a.text}"`;
    case "jsonPathEquals":
      return `${a.path} equals "${a.value}"`;
    case "jsonPathExists":
      return `${a.path} exists`;
  }
}
