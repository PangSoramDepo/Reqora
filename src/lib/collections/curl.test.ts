import { describe, expect, it } from "vitest";
import { ImportError, parseCurl, toCurl, tokenize } from "./curl";

describe("tokenize", () => {
  it("handles quotes, escapes and line continuations", () => {
    expect(tokenize(`curl 'a b' "c \\"d\\"" e\\ f \\\n  -X POST`)).toEqual(["curl", "a b", 'c "d"', "e f", "-X", "POST"]);
    expect(tokenize("curl $'x\\ny'")).toEqual(["curl", "x\ny"]);
    expect(tokenize("curl ^\r\n -v")).toEqual(["curl", "-v"]);
  });

  it("rejects unterminated quotes", () => {
    expect(() => tokenize("curl 'abc")).toThrow(ImportError);
  });
});

describe("parseCurl", () => {
  it("parses a typical JSON POST with headers", () => {
    const { name, definition } = parseCurl(`curl -X POST 'https://api.example.com/v2/orders?expand=items&limit=5' \\
      -H 'Content-Type: application/json' \\
      -H "X-Trace: abc" \\
      --data-raw '{"sku":"A-1","qty":2}'`);
    expect(name).toBe("POST /v2/orders");
    expect(definition.method).toBe("POST");
    expect(definition.url).toBe("https://api.example.com/v2/orders");
    expect(definition.params).toEqual([
      { key: "expand", value: "items", enabled: true },
      { key: "limit", value: "5", enabled: true },
    ]);
    expect(definition.headers).toEqual([
      { key: "Content-Type", value: "application/json", enabled: true },
      { key: "X-Trace", value: "abc", enabled: true },
    ]);
    expect(definition.body).toEqual({ type: "json", text: '{"sku":"A-1","qty":2}' });
  });

  it("defaults to POST with -d and GET without", () => {
    expect(parseCurl("curl https://x.dev -d a=1").definition.method).toBe("POST");
    expect(parseCurl("curl https://x.dev").definition.method).toBe("GET");
  });

  it("treats non-JSON -d as a form body and joins repeated data with &", () => {
    const { definition } = parseCurl("curl https://x.dev/form -d a=1 --data b=2");
    expect(definition.body).toEqual({ type: "text", text: "a=1&b=2" });
    expect(definition.headers).toContainEqual({ key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true });
  });

  it("supports --json", () => {
    const { definition } = parseCurl(`curl --json '{"a":1}' https://x.dev/j`);
    expect(definition.method).toBe("POST");
    expect(definition.body).toEqual({ type: "json", text: '{"a":1}' });
    expect(definition.headers.map((h) => h.key)).toEqual(["Content-Type", "Accept"]);
  });

  it("maps -u to basic auth and bearer headers to bearer auth", () => {
    expect(parseCurl("curl -u alice:s3cret https://x.dev").definition.auth).toEqual({
      type: "basic",
      username: "alice",
      password: "s3cret",
    });
    const bearer = parseCurl(`curl https://x.dev -H "Authorization: Bearer tok_123"`).definition;
    expect(bearer.auth).toEqual({ type: "bearer", token: "tok_123" });
    expect(bearer.headers).toEqual([]);
  });

  it("handles attached short options, --opt=value, --request and ignores noise flags", () => {
    const { definition } = parseCurl(`curl -sSL --compressed -XPATCH -H'X-A: 1' --url=https://x.dev/p -k`);
    expect(definition.method).toBe("PATCH");
    expect(definition.url).toBe("https://x.dev/p");
    expect(definition.headers).toEqual([{ key: "X-A", value: "1", enabled: true }]);
  });

  it("adds a scheme when missing and supports -G", () => {
    const { definition } = parseCurl("curl -G example.com/search -d q=reqora");
    expect(definition.url).toBe("http://example.com/search");
    expect(definition.method).toBe("GET");
    expect(definition.params).toEqual([{ key: "q", value: "reqora", enabled: true }]);
  });

  it("rejects input that isn't curl or has no URL", () => {
    expect(() => parseCurl("wget https://x.dev")).toThrow(ImportError);
    expect(() => parseCurl("curl -X POST")).toThrow(/no URL/);
  });
});

describe("toCurl", () => {
  it("quotes values for the shell and round-trips through the importer", () => {
    const body = String.raw`{"name":"O'Brien"}`;
    const command = toCurl({
      method: "post",
      url: "https://api.example.com/orders?q=a&b=c",
      headers: { "Content-Type": "application/json", "X-Note": "it's [secret]" },
      body,
    });
    expect(command).toBe(
      [
        "curl -X POST 'https://api.example.com/orders?q=a&b=c'",
        "  -H 'Content-Type: application/json'",
        String.raw`  -H 'X-Note: it'\''s [secret]'`,
        String.raw`  --data-raw '{"name":"O'\''Brien"}'`,
      ].join(" \\\n"),
    );
    const parsed = parseCurl(command).definition;
    expect(parsed.method).toBe("POST");
    expect(parsed.headers.find((h) => h.key === "X-Note")?.value).toBe("it's [secret]");
    expect(parsed.body).toEqual({ type: "json", text: body });
  });
});

describe("form bodies in cURL", () => {
  it("imports -F fields as form-data and exports them back as -F", () => {
    const { definition } = parseCurl(`curl https://x.test/up -H 'Content-Type: multipart/form-data' -F 'name=Ann' -F 'doc=@./a.pdf;type=application/pdf'`);
    expect(definition.method).toBe("POST");
    expect(definition.headers).toEqual([]);
    expect(definition.body).toEqual({
      type: "formdata",
      fields: [
        { kind: "text", key: "name", value: "Ann", enabled: true },
        { kind: "file", key: "doc", enabled: true, fileName: "", contentType: "application/pdf", data: "" },
      ],
    });
    const command = toCurl({
      method: "POST",
      url: "https://x.test/up",
      headers: { "Content-Type": "multipart/form-data; boundary=b", "X-A": "1" },
      body: "ignored",
      form: [{ key: "name", value: "Ann" }, { key: "doc", fileName: "a.pdf", contentType: "application/pdf", size: 3 }],
    });
    expect(command).toBe(
      ["curl -X POST 'https://x.test/up'", "-H 'X-A: 1'", "--form-string 'name=Ann'", "-F 'doc=@a.pdf;type=application/pdf'"].join(" \\\n  "),
    );
  });
});

describe("binary bodies in cURL", () => {
  it("exports the file as --data-binary @name", () => {
    expect(toCurl({ method: "PUT", url: "https://x.test/f", headers: {}, body: "<4 bytes from pic.png>", file: { fileName: "pic.png", contentType: "image/png", size: 4 } })).toBe(
      ["curl -X PUT 'https://x.test/f'", "--data-binary '@pic.png'"].join(" \\\n  "),
    );
  });
});
