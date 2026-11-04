import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secrets/variables", () => ({
  resolveVariable: (_env: string, name: string) => (name === "TOKEN" ? "tok_super_secret" : undefined),
}));
const { sendDefinition } = await import("./send");
const { emptyDefinition } = await import("./schema");

describe("sendDefinition", () => {
  it("sends, evaluates assertions and scrubs resolved secrets from the echoed response", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      return Response.json({ echoed: headers.get("authorization"), url: String(url) }, { status: 201, statusText: "Created" });
    });
    const result = await sendDefinition(
      {
        ...emptyDefinition(),
        method: "POST",
        url: "/api/echo",
        params: [{ key: "k", value: "{{env.TOKEN}}", enabled: true }],
        auth: { type: "bearer", token: "{{env.TOKEN}}" },
        body: { type: "json", text: '{"a":1}' },
        assertions: [
          { type: "status", equals: 201 },
          { type: "jsonPathExists", path: "echoed" },
        ],
      },
      { environment: "sandbox", baseUrl: "http://localhost:3000", fetch: fetchMock as typeof fetch },
    );
    expect(fetchMock).toHaveBeenCalledOnce();
    expect("status" in result && result.status).toBe(201);
    if (!("status" in result)) return;
    expect(result.body).toEqual({ echoed: "Bearer [secret]", url: "http://localhost:3000/api/echo?k=[secret]" });
    expect(result.url).toBe("http://localhost:3000/api/echo?k=[secret]");
    expect(result.assertions.every((a) => a.passed)).toBe(true);
    expect(JSON.stringify(result)).not.toContain("tok_super_secret");
  });

  it("returns an error payload for missing variables and network failures", async () => {
    const missing = await sendDefinition(
      { ...emptyDefinition(), url: "https://x.dev/{{env.NOPE}}" },
      { environment: "sandbox", baseUrl: "http://localhost", fetch: vi.fn() as unknown as typeof fetch },
    );
    expect(missing).toEqual({ error: expect.stringContaining('"NOPE"'), durationMs: 0 });

    const failing = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    });
    const down = await sendDefinition(
      { ...emptyDefinition(), url: "http://127.0.0.1:1/x" },
      { environment: "sandbox", baseUrl: "http://localhost", fetch: failing as unknown as typeof fetch },
    );
    expect(down).toMatchObject({ error: "request failed: ECONNREFUSED", url: "http://127.0.0.1:1/x" });
  });
});
