import { describe, expect, it } from "vitest";
import { collectionExportSchema } from "./schema";
import { maskValue, scanCollection, withoutExamples } from "./secret-scan";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
const exported = (requests: unknown[], settings: unknown = {}) =>
  collectionExportSchema.parse({ reqora: "collection", version: 1, collection: { name: "Bank", settings, requests } });
const req = (name: string, definition: unknown, examples: unknown[] = []) => ({ name, definition, examples });
const wheres = (e: ReturnType<typeof exported>) => scanCollection(e).map((f) => f.where);

describe("scanCollection", () => {
  it("leaves templated requests alone", () => {
    const clean = exported([
      req("Login", {
        method: "POST",
        url: "{{env.BASE_URL}}/login",
        headers: [{ key: "Authorization", value: "Bearer {{user.access_token}}" }, { key: "Accept", value: "application/json" }],
        auth: { type: "bearer", token: "{{env.TOKEN}}" },
        body: { type: "json", text: '{ "login_id": "{{user.login_id}}", "password": "{{user.password}}" }' },
        postScript: 'rq.user.set("access_token", rq.response.json().access_token);',
      }),
    ]);
    expect(scanCollection(clean)).toEqual([]);
  });

  it("finds typed-in credentials in headers, auth, body, params and scripts", () => {
    const leaky = exported(
      [
        req("Login", {
          url: "https://api.test/login?api_key=abcd1234",
          params: [{ key: "api_key", value: "abcd1234" }],
          headers: [{ key: "Authorization", value: `Bearer ${jwt}` }],
          auth: { type: "basic", username: "maker", password: "hunter22" },
          body: { type: "json", text: '{ "login_id": "1001", "nested": { "password": "pw-maker-01" } }' },
          preScript: 'const apiKey = "sk_test_123456";\nrq.environment.set("token", "abc-very-secret");',
        }),
      ],
      { headers: [{ key: "X-Api-Key", value: "collection-level-key" }] },
    );
    const found = wheres(leaky);
    expect(found).toEqual(
      expect.arrayContaining([
        "Bank (collection) › Header “X-Api-Key”",
        "Bank › Login › Param “api_key”",
        "Bank › Login › Header “Authorization”",
        "Bank › Login › Auth (Basic password)",
        "Bank › Login › Body › “password”",
        "Bank › Login › Pre-request script › “apiKey”",
        "Bank › Login › Pre-request script › “token”",
      ]),
    );
    expect(found).not.toContain("Bank › Login › Body › “login_id”");
    const auth = scanCollection(leaky).find((f) => f.where.endsWith("Header “Authorization”"))!;
    expect(auth.why).toBe("looks like a JWT");
    expect(auth.preview).not.toContain(jwt.slice(10, 30)); // masked
  });

  it("flags tokens in saved examples, which can be left out", () => {
    const withExample = exported([
      req("Login", { method: "POST", url: "/login" }, [
        { name: "OK", response: { status: 200, headers: { "set-cookie": "sid=abc123456" }, body: { access_token: jwt, user: { name: "Maker" } } } },
      ]),
    ]);
    const findings = scanCollection(withExample);
    expect(findings.map((f) => [f.where, f.inExample])).toEqual([
      ["Bank › Login › Example “OK” › Header “set-cookie”", true],
      ["Bank › Login › Example “OK” › Body › “access_token”", true],
    ]);
    expect(scanCollection(withoutExamples(withExample))).toEqual([]);
  });

  it("masks previews", () => {
    expect(maskValue("short")).toBe("•••••");
    expect(maskValue("abcdefghijkl")).toBe("abc•••jkl (12 chars)");
  });
});
