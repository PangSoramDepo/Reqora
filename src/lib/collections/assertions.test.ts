import { describe, expect, it } from "vitest";
import { evaluateAssertions, getPath } from "./assertions";
import type { Assertion } from "./schema";

const response = {
  status: 201,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: { ok: true, customer: { id: "usr_1", score: 12 }, items: [{ sku: "A-1" }], none: null },
  bodyText: '{"ok":true,"customer":{"id":"usr_1"}}',
  durationMs: 140,
};

describe("getPath", () => {
  it("resolves dot paths, indexes and $. prefixes", () => {
    expect(getPath(response.body, "customer.id")).toEqual({ found: true, value: "usr_1" });
    expect(getPath(response.body, "items.0.sku")).toEqual({ found: true, value: "A-1" });
    expect(getPath(response.body, "$.items[0].sku")).toEqual({ found: true, value: "A-1" });
    expect(getPath(response.body, "none")).toEqual({ found: true, value: null });
    expect(getPath(response.body, "customer.missing").found).toBe(false);
    expect(getPath("text", "a").found).toBe(false);
  });
});

describe("evaluateAssertions", () => {
  it("evaluates each assertion type", () => {
    const assertions: Assertion[] = [
      { type: "status", equals: 201 },
      { type: "status", equals: 200 },
      { type: "responseTimeBelow", ms: 200 },
      { type: "responseTimeBelow", ms: 100 },
      { type: "headerContains", header: "Content-Type", value: "json" },
      { type: "headerContains", header: "x-missing", value: "a" },
      { type: "bodyContains", text: "usr_1" },
      { type: "jsonPathEquals", path: "customer.score", value: "12" },
      { type: "jsonPathEquals", path: "ok", value: "true" },
      { type: "jsonPathEquals", path: "customer.id", value: "usr_2" },
      { type: "jsonPathExists", path: "items.0" },
      { type: "jsonPathExists", path: "items.3" },
    ];
    const results = evaluateAssertions(assertions, response);
    expect(results.map((r) => r.passed)).toEqual([true, false, true, false, true, false, true, true, true, false, true, false]);
    expect(results[1].actual).toBe("201");
    expect(results[5].actual).toBe("(header missing)");
    expect(results[9].actual).toBe("usr_1");
    expect(results[11].actual).toBe("(path not found)");
  });

  it("compares objects by JSON", () => {
    const [r] = evaluateAssertions([{ type: "jsonPathEquals", path: "items", value: '[{"sku":"A-1"}]' }], response);
    expect(r.passed).toBe(true);
  });
});
