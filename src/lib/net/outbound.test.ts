import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { blockedReason, fetchErrorMessage, outboundFetch, parsePolicy } from "./outbound";

describe("blockedReason", () => {
  const none = parsePolicy(undefined);

  it("allows public addresses", () => {
    expect(blockedReason("93.184.216.34", "example.com", none)).toBeUndefined();
    expect(blockedReason("2606:4700::1111", "one.one.one.one", none)).toBeUndefined();
  });

  it("always blocks link-local (cloud metadata), unspecified, multicast and reserved, even when private is allowed", () => {
    const all = parsePolicy("private");
    for (const ip of ["169.254.169.254", "0.0.0.0", "224.0.0.1", "255.255.255.255", "fe80::1", "::", "::ffff:169.254.169.254"]) {
      expect(blockedReason(ip, ip, all), ip).toMatch(/never contacts/);
    }
  });

  it("blocks loopback and private ranges by default, with a hint to allow them", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.10", "100.64.0.1", "::1", "fd12::1", "::ffff:10.0.0.1"]) {
      expect(blockedReason(ip, ip, none), ip).toMatch(/private network address/);
    }
    expect(blockedReason("10.1.2.3", "api.internal", none)).toBe(
      "blocked: api.internal (10.1.2.3) is a private network address. To allow it, add REQORA_ALLOW_NETWORKS=api.internal to .env.local and restart Reqora",
    );
  });

  it("allows private addresses listed in REQORA_ALLOW_NETWORKS by CIDR, host name or wildcard", () => {
    const policy = parsePolicy(" 10.20.0.0/16, api.internal ,*.corp.example, fd00::/8, not a host!");
    expect(blockedReason("10.20.5.5", "10.20.5.5", policy)).toBeUndefined();
    expect(blockedReason("10.21.5.5", "10.21.5.5", policy)).toMatch(/private/);
    expect(blockedReason("10.9.9.9", "api.internal", policy)).toBeUndefined();
    expect(blockedReason("10.9.9.9", "svc.corp.example", policy)).toBeUndefined();
    expect(blockedReason("10.9.9.9", "corp.example.evil", policy)).toMatch(/private/);
    expect(blockedReason("fd00::5", "fd00::5", policy)).toBeUndefined();
    expect(blockedReason("192.168.0.1", "x", parsePolicy("private"))).toBeUndefined();
  });
});

describe("outboundFetch", () => {
  let server: http.Server;
  let other: http.Server;
  let origin: string;
  let otherOrigin: string;

  beforeAll(async () => {
    const listen = (s: http.Server) => new Promise<string>((r) => s.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));
    other = http.createServer((_req, res) => res.end("internal"));
    otherOrigin = await listen(other);
    server = http.createServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: `${otherOrigin}/secret` });
        return res.end();
      }
      res.end("self");
    });
    origin = await listen(server);
  });
  afterAll(() => {
    server.close();
    other.close();
    delete process.env.REQORA_ALLOW_NETWORKS;
  });

  const attempt = (f: typeof fetch, url: string) =>
    f(url).then(
      (r) => r.text(),
      (e: unknown) => `ERROR ${fetchErrorMessage(e)}`,
    );

  it("reaches the Reqora origin itself, but not other loopback services", async () => {
    const f = outboundFetch(origin);
    expect(await attempt(f, `${origin}/x`)).toBe("self");
    expect(await attempt(f, `${otherOrigin}/x`)).toMatch(/^ERROR blocked: 127\.0\.0\.1 is a private network address/);
  });

  it("checks every redirect hop", async () => {
    expect(await attempt(outboundFetch(origin), `${origin}/redirect`)).toMatch(/^ERROR blocked: 127\.0\.0\.1/);
  });

  it("checks names after DNS resolution", async () => {
    const port = new URL(otherOrigin).port;
    expect(await attempt(outboundFetch(), `http://localhost:${port}/x`)).toMatch(/^ERROR blocked: localhost \((127\.0\.0\.1|::1)\)/);
  });

  it("allows what REQORA_ALLOW_NETWORKS lists", async () => {
    process.env.REQORA_ALLOW_NETWORKS = "127.0.0.0/8";
    expect(await attempt(outboundFetch(), `${otherOrigin}/x`)).toBe("internal");
    delete process.env.REQORA_ALLOW_NETWORKS;
  });
});
