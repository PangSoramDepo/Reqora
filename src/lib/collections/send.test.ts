import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/secrets/variables", () => ({
  resolveVariable: (_env: string, name: string) => (name === "TOKEN" ? "tok_super_secret" : undefined),
  setVariableValue: () => ({ kind: "plain" }),
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
    expect(missing).toMatchObject({ error: expect.stringContaining('"NOPE"'), durationMs: 0 });

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

describe("sendRequest with inherited settings and scripts", () => {
  it("applies collection auth/headers, runs scripts outermost first, and scrubs secrets from logs and output", async () => {
    const { sendRequest } = await import("./send");
    const { emptyScopeSettings } = await import("./schema");
    const seen: { url: string; headers: Record<string, string>; body?: string }[] = [];
    let raw: Awaited<ReturnType<typeof sendRequest>> | undefined;
    const fake = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seen.push({ url: String(url), headers, body: init?.body as string });
      return Response.json({ echo: headers.Authorization, id: "o-7" });
    });

    const result = await sendRequest(
      {
        name: "Create order",
        definition: {
          ...emptyDefinition(),
          method: "POST",
          url: "https://api.test/{{vars.version}}/orders",
          body: { type: "json", text: '{"sig":"{{vars.sig}}"}' },
          postScript: `rq.test("ok", () => rq.expect(rq.response.json().id).toBe("o-7"));`,
        },
        collection: {
          name: "Shop API",
          settings: {
            ...emptyScopeSettings(),
            auth: { type: "bearer", token: "{{env.TOKEN}}" },
            headers: [{ key: "X-Client", value: "reqora", enabled: true }],
            preScript: `rq.variables.set("version", "v2"); console.log("token", rq.environment.get("TOKEN"));`,
          },
        },
        folder: {
          name: "Orders",
          settings: { ...emptyScopeSettings(), preScript: `rq.variables.set("sig", "s-" + rq.variables.get("version"));` },
        },
      },
      {
        environment: "production",
        baseUrl: "http://localhost",
        fetch: fake as unknown as typeof fetch,
        onUnscrubbed: (o) => (raw = o),
      },
    );

    // The history copy keeps the real values; the returned result is scrubbed.
    expect(raw && "request" in raw ? raw.request?.headers.Authorization : null).toBe("Bearer tok_super_secret");
    expect(seen[0].url).toBe("https://api.test/v2/orders");
    expect(seen[0].headers).toMatchObject({
      "X-Client": "reqora",
      Authorization: "Bearer tok_super_secret",
      "User-Agent": "ReqoraRuntime/1.0", // not Node's default "node", which device detectors flag as a bot
    });
    expect(seen[0].body).toBe('{"sig":"s-v2"}');
    if (!("status" in result)) throw new Error(result.error);
    expect(result.scripts.tests).toMatchObject([{ name: "ok", passed: true, scope: "request" }]);
    expect(result.scripts.variables).toEqual({ version: "v2", sig: "s-v2" });
    expect(result.scripts.logs[0].message).toBe("token [secret]");
    expect((result.body as { echo: string }).echo).toBe("Bearer [secret]");
    expect(JSON.stringify(result)).not.toContain("tok_super_secret");
  });

  it("resolves {{env.*}} set by a pre-request script and saves the change to the environment", async () => {
    const writeEnv = vi.fn(() => ({ kind: "plain" as const }));
    const fetchMock = vi.fn(async (url: string | URL | Request) => Response.json({ url: String(url) }));
    const result = await sendDefinition(
      { ...emptyDefinition(), url: "/api/users/{{env.login_id}}", preScript: `rq.environment.set("login_id", "123");` },
      { environment: "staging", baseUrl: "http://localhost:3000", fetch: fetchMock as typeof fetch, writeEnv },
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://localhost:3000/api/users/123");
    expect(writeEnv).toHaveBeenCalledWith("staging", "login_id", "123");
    expect("scripts" in result && result.scripts?.environment).toEqual({ login_id: "123" });
  });

  it("aborts the send when a pre-request script fails", async () => {
    const { sendRequest } = await import("./send");
    const fake = vi.fn();
    const result = await sendRequest(
      { name: "r", definition: { ...emptyDefinition(), url: "https://x.test", preScript: "throw new Error('nope')" } },
      { environment: "production", baseUrl: "http://localhost", fetch: fake as unknown as typeof fetch },
    );
    expect(fake).not.toHaveBeenCalled();
    expect(result).toMatchObject({ error: "pre-request script (request “r”) failed: Error: nope" });
  });
});
