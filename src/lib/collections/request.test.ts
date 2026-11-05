import { describe, expect, it } from "vitest";
import { TemplateError, type TemplateContext } from "@/lib/workflows/template";
import { authHeader, buildUrl, convertBody, headerRecord, prepareRequest } from "./request";
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
    const body = JSON.parse(prepared.body as string);
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

describe("form bodies", () => {
  it("sends urlencoded fields rendered then encoded, skipping disabled ones", () => {
    const prepared = prepareRequest(
      def({
        method: "POST",
        url: "https://x.test/token",
        body: {
          type: "urlencoded",
          fields: [
            { key: "grant_type", value: "client credentials", enabled: true },
            { key: "secret", value: "{{env.TOKEN}}&x", enabled: true },
            { key: "off", value: "1", enabled: false },
          ],
        },
      }),
      ctx,
      "http://localhost",
    );
    expect(prepared.body).toBe("grant_type=client+credentials&secret=tok_secret%26x");
    expect(prepared.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("builds multipart form-data with text and file parts and a matching boundary", () => {
    const prepared = prepareRequest(
      def({
        method: "POST",
        url: "https://x.test/upload",
        headers: [{ key: "content-type", value: "multipart/form-data", enabled: true }],
        body: {
          type: "formdata",
          fields: [
            { kind: "text", key: "token", value: "{{env.TOKEN}}", enabled: true },
            { kind: "file", key: "doc", enabled: true, fileName: "a.txt", contentType: "text/plain", data: btoa("hello") },
          ],
        },
      }),
      ctx,
      "http://localhost",
    );
    const contentType = prepared.headers["Content-Type"];
    const boundary = /boundary=(.+)$/.exec(contentType)![1];
    expect(Object.keys(prepared.headers).filter((k) => k.toLowerCase() === "content-type")).toHaveLength(1);
    const wire = new TextDecoder().decode(prepared.body as Uint8Array);
    expect(wire).toBe(
      `--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\ntok_secret\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="doc"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n` +
        `--${boundary}--\r\n`,
    );
    expect(prepared.bodyText).toContain("<5 bytes from a.txt>");
    expect(prepared.form).toEqual([
      { key: "token", value: "tok_secret" },
      { key: "doc", fileName: "a.txt", contentType: "text/plain", size: 5 },
    ]);
  });

  it("parses back with the platform's multipart parser", async () => {
    const prepared = prepareRequest(
      def({
        method: "POST",
        body: {
          type: "formdata",
          fields: [
            { kind: "text", key: "name", value: 'é "q"', enabled: true },
            { kind: "file", key: "bin", enabled: true, fileName: "x.bin", contentType: "", data: btoa(String.fromCharCode(0, 255, 10, 13)) },
          ],
        },
      }),
      ctx,
      "http://localhost",
    );
    const form = await new Response(prepared.body as Uint8Array<ArrayBuffer>, { headers: { "content-type": prepared.headers["Content-Type"] } }).formData();
    expect(form.get("name")).toBe('é "q"');
    const file = form.get("bin") as File;
    expect([file.name, file.type, [...new Uint8Array(await file.arrayBuffer())]]).toEqual(["x.bin", "application/octet-stream", [0, 255, 10, 13]]);
  });

  it("refuses a file field with no file chosen", () => {
    expect(() =>
      prepareRequest(
        def({ method: "POST", body: { type: "formdata", fields: [{ kind: "file", key: "doc", enabled: true, fileName: "", contentType: "", data: "" }] } }),
        ctx,
        "http://localhost",
      ),
    ).toThrow(/has no file chosen/);
  });

  it("converts between formats, keeping what fits", () => {
    expect(convertBody({ type: "text", text: "a=1&b=x%20y" }, "urlencoded")).toEqual({
      type: "urlencoded",
      fields: [
        { key: "a", value: "1", enabled: true },
        { key: "b", value: "x y", enabled: true },
      ],
    });
    expect(convertBody({ type: "json", text: '{"a":1}' }, "urlencoded")).toEqual({ type: "urlencoded", fields: [] });
    const urlencoded = { type: "urlencoded" as const, fields: [{ key: "a", value: "{{env.X}}", enabled: true }] };
    expect(convertBody(urlencoded, "formdata")).toEqual({ type: "formdata", fields: [{ kind: "text", key: "a", value: "{{env.X}}", enabled: true }] });
    expect(convertBody(urlencoded, "text")).toEqual({ type: "text", text: "a={{env.X}}" });
    expect(convertBody({ type: "json", text: "{}" }, "text")).toEqual({ type: "text", text: "{}" });
  });
});

describe("binary bodies", () => {
  const file = { type: "binary" as const, fileName: "pic.png", contentType: "image/png", data: btoa(String.fromCharCode(137, 80, 78, 71)) };

  it("sends the file bytes with its content type", () => {
    const prepared = prepareRequest(def({ method: "PUT", body: file }), ctx, "http://localhost");
    expect([...(prepared.body as Uint8Array)]).toEqual([137, 80, 78, 71]);
    expect(prepared.headers["Content-Type"]).toBe("image/png");
    expect(prepared.file).toEqual({ fileName: "pic.png", contentType: "image/png", size: 4 });
    expect(prepared.bodyText).toBe("<4 bytes from pic.png>");
  });

  it("keeps a Content-Type header you set, and sends nothing when no file is chosen", () => {
    const own = prepareRequest(def({ method: "PUT", headers: [{ key: "Content-Type", value: "application/octet-stream", enabled: true }], body: file }), ctx, "http://x");
    expect(own.headers["Content-Type"]).toBe("application/octet-stream");
    const empty = prepareRequest(def({ method: "PUT", body: convertBody({ type: "json", text: "{}" }, "binary") }), ctx, "http://x");
    expect(empty.body).toBeUndefined();
  });
});
