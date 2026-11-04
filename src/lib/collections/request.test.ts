import { describe, expect, it } from "vitest";
import { TemplateError, type TemplateContext } from "@/lib/workflows/template";
import { authHeader, buildUrl, headerRecord, prepareRequest } from "./request";
import { emptyDefinition, type RequestDefinition } from "./schema";
import { requestToNode } from "./to-node";

const ctx: TemplateContext = {
  trigger: {},
  nodes: {},
  env: (name) => {
    if (name === "TOKEN") return "tok_secret";
    if (name === "HOST") return "api.example.com";
    throw new TemplateError(`environment variable "${name}" is not configured`);
  },
};

const def = (patch: Partial<RequestDefinition>): RequestDefinition => ({ ...emptyDefinition(), ...patch });

describe("buildUrl", () => {
  it("appends enabled params, encoding keys and values", () => {
    expect(
      buildUrl("https://x.dev/a", [
        { key: "q", value: "a b&c", enabled: true },
        { key: "off", value: "1", enabled: false },
        { key: " ", value: "blank", enabled: true },
        { key: "n", value: "", enabled: true },
      ]),
    ).toBe("https://x.dev/a?q=a%20b%26c&n=");
  });

  it("merges with an existing query and keeps the fragment", () => {
    expect(buildUrl("https://x.dev/a?x=1#top", [{ key: "y", value: "2", enabled: true }])).toBe("https://x.dev/a?x=1&y=2#top");
    expect(buildUrl("https://x.dev/a?", [{ key: "y", value: "2", enabled: true }])).toBe("https://x.dev/a?y=2");
    expect(buildUrl("https://x.dev/a", [])).toBe("https://x.dev/a");
  });
});

describe("auth headers", () => {
  it("produces bearer, basic and api key headers", () => {
    expect(authHeader({ type: "none" })).toBeUndefined();
    expect(authHeader({ type: "bearer", token: "abc" })).toEqual(["Authorization", "Bearer abc"]);
    expect(authHeader({ type: "basic", username: "alice", password: "pä55" })).toEqual([
      "Authorization",
      `Basic ${Buffer.from("alice:pä55").toString("base64")}`,
    ]);
    expect(authHeader({ type: "apiKey", header: "X-Api-Key", value: "k" })).toEqual(["X-Api-Key", "k"]);
    expect(authHeader({ type: "bearer", token: "" })).toBeUndefined();
  });

  it("lets an explicit header win over auth and skips disabled headers", () => {
    expect(
      headerRecord(
        [
          { key: "authorization", value: "Custom 1", enabled: true },
          { key: "X-Off", value: "1", enabled: false },
        ],
        { type: "bearer", token: "abc" },
      ),
    ).toEqual({ authorization: "Custom 1" });
  });
});

describe("prepareRequest", () => {
  it("renders templates in URL, params, headers, auth and JSON body", () => {
    const prepared = prepareRequest(
      def({
        method: "POST",
        url: "https://{{env.HOST}}/v1/orders",
        params: [{ key: "t", value: "{{$timestamp}}", enabled: true }],
        headers: [{ key: "X-Trace", value: "{{$guid}}", enabled: true }],
        auth: { type: "bearer", token: "{{env.TOKEN}}" },
        body: { type: "json", text: '{"token":"{{env.TOKEN}}","n":{{$timestamp}}}' },
      }),
      ctx,
      "http://localhost:3000",
    );
    expect(prepared.url).toMatch(/^https:\/\/api\.example\.com\/v1\/orders\?t=\d+$/);
    expect(prepared.headers.Authorization).toBe("Bearer tok_secret");
    expect(prepared.headers["X-Trace"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(prepared.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(prepared.body!);
    expect(body.token).toBe("tok_secret");
    expect(typeof body.n).toBe("number");
  });

  it("resolves relative URLs against the base and drops bodies on GET", () => {
    const prepared = prepareRequest(def({ url: "/api/demo/x", body: { type: "json", text: "{}" } }), ctx, "http://localhost:3000");
    expect(prepared.url).toBe("http://localhost:3000/api/demo/x");
    expect(prepared.body).toBeUndefined();
  });

  it("encodes basic auth after rendering and sends text bodies as text/plain", () => {
    const prepared = prepareRequest(
      def({ method: "PUT", url: "https://x.dev", auth: { type: "basic", username: "u", password: "{{env.TOKEN}}" }, body: { type: "text", text: "hi" } }),
      ctx,
      "http://localhost",
    );
    expect(prepared.headers.Authorization).toBe(`Basic ${Buffer.from("u:tok_secret").toString("base64")}`);
    expect(prepared.headers["Content-Type"]).toBe("text/plain");
    expect(prepared.body).toBe("hi");
  });

  it("throws TemplateError for missing variables", () => {
    expect(() => prepareRequest(def({ url: "https://x.dev/{{env.NOPE}}" }), ctx, "http://localhost")).toThrow(TemplateError);
  });
});

describe("requestToNode", () => {
  const workflow = {
    nodes: [
      { id: "webhook-1", type: "webhook", name: "W", position: { x: 0, y: 40 }, config: { method: "POST", path: "/x" } },
      { id: "http-1", type: "http", name: "H", position: { x: 300, y: 90 }, config: { method: "GET", url: "/", headers: {}, timeoutMs: 1000 } },
    ],
  } as Parameters<typeof requestToNode>[2];

  it("converts the request and places it right of the rightmost node", () => {
    const result = requestToNode(
      "Create order",
      def({
        method: "POST",
        url: "/api/demo/slack/messages",
        params: [{ key: "a", value: "1", enabled: true }],
        headers: [{ key: "X-A", value: "b", enabled: true }],
        auth: { type: "bearer", token: "{{env.TOKEN}}" },
        body: { type: "json", text: '{"x":1}' },
      }),
      workflow,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.node.id).toBe("http-2");
    expect(result.node.name).toBe("Create order");
    expect(result.node.position).toEqual({ x: 580, y: 90 });
    expect(result.node.config).toEqual({
      method: "POST",
      url: "/api/demo/slack/messages?a=1",
      headers: { "X-A": "b", Authorization: "Bearer {{env.TOKEN}}" },
      body: '{"x":1}',
      timeoutMs: 10_000,
    });
  });

  it("blocks methods and bodies workflow nodes can't express", () => {
    expect(requestToNode("x", def({ method: "HEAD", url: "/a" }), workflow).ok).toBe(false);
    expect(requestToNode("x", def({ method: "POST", url: "/a", body: { type: "text", text: "hi" } }), workflow).ok).toBe(false);
  });
});
