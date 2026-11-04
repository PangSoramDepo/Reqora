import "server-only";

import dns from "node:dns";
import net from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";

/**
 * Outbound network policy for everything the server sends on a user's behalf (Collections sends, workflow HTTP
 * nodes, load tests). Without it, any signed-in user could make the server call internal services or cloud
 * metadata endpoints.
 *
 * - Always blocked: link-local (incl. cloud metadata 169.254.169.254), "this network" 0.0.0.0/8, multicast,
 *   reserved and their IPv6 equivalents.
 * - Blocked unless allowed: loopback, private (10/8, 172.16/12, 192.168/16, fc00::/7), carrier-grade NAT
 *   (100.64/10) and benchmarking (198.18/15) ranges. Allow them with `REQORA_ALLOW_NETWORKS`: a comma-separated
 *   list of CIDRs (`10.20.0.0/16`), host names (`api.internal`, `*.corp.example`) or `private` for all of them.
 * - Reqora's own origin is always reachable (relative URLs such as `/api/demo/...`).
 *
 * The check runs when each connection is opened — after DNS resolution, for every redirect hop — so DNS
 * rebinding and redirects to internal addresses are caught too.
 */

export class OutboundBlockedError extends Error {
  readonly code = "REQORA_OUTBOUND_BLOCKED";
}

const ALWAYS_BLOCKED = new net.BlockList();
for (const [range, prefix] of [
  ["0.0.0.0", 8],
  ["169.254.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  ALWAYS_BLOCKED.addSubnet(range, prefix, "ipv4");
}
for (const [range, prefix] of [
  ["::", 128],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  ALWAYS_BLOCKED.addSubnet(range, prefix, "ipv6");
}

const PRIVATE = new net.BlockList();
for (const [range, prefix] of [
  ["127.0.0.0", 8],
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["100.64.0.0", 10],
  ["198.18.0.0", 15],
] as const) {
  PRIVATE.addSubnet(range, prefix, "ipv4");
}
for (const [range, prefix] of [
  ["::1", 128],
  ["fc00::", 7],
] as const) {
  PRIVATE.addSubnet(range, prefix, "ipv6");
}

type Policy = { allowAllPrivate: boolean; networks: net.BlockList; hosts: string[] };

/** Parses `REQORA_ALLOW_NETWORKS`; invalid entries are ignored (and reported once). */
export function parsePolicy(value: string | undefined): Policy {
  const policy: Policy = { allowAllPrivate: false, networks: new net.BlockList(), hosts: [] };
  for (const raw of (value ?? "").split(",")) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry === "private" || entry === "*") {
      policy.allowAllPrivate = true;
      continue;
    }
    const [address, bits] = entry.split("/");
    const family = net.isIP(address);
    if (family) {
      const prefix = bits === undefined ? (family === 4 ? 32 : 128) : Number(bits);
      if (Number.isInteger(prefix) && prefix >= 0 && prefix <= (family === 4 ? 32 : 128)) {
        policy.networks.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
        continue;
      }
    } else if (/^(\*\.)?[a-z0-9.-]+$/.test(entry)) {
      policy.hosts.push(entry);
      continue;
    }
    console.warn(`REQORA_ALLOW_NETWORKS: ignoring invalid entry "${raw.trim()}"`);
  }
  return policy;
}

const hostMatches = (host: string, pattern: string) =>
  pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) : host === pattern;

/** `::ffff:10.0.0.1` → `10.0.0.1`, so mapped addresses can't dodge the IPv4 ranges. */
function normalize(address: string): { address: string; type: "ipv4" | "ipv6" } {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return { address: mapped[1], type: "ipv4" };
  return { address, type: net.isIP(address) === 6 ? "ipv6" : "ipv4" };
}

/** Why the address may not be contacted for `host`, or undefined when it may. */
export function blockedReason(address: string, host: string, policy: Policy): string | undefined {
  const ip = normalize(address);
  const shown = host === address ? address : `${host} (${address})`;
  if (ALWAYS_BLOCKED.check(ip.address, ip.type)) {
    return `blocked: ${shown} is a link-local, multicast or reserved address (such as cloud metadata), which Reqora never contacts`;
  }
  if (!PRIVATE.check(ip.address, ip.type)) return undefined;
  if (policy.allowAllPrivate || policy.networks.check(ip.address, ip.type) || policy.hosts.some((p) => hostMatches(host.toLowerCase(), p))) {
    return undefined;
  }
  return `blocked: ${shown} is a private network address. To allow it, add REQORA_ALLOW_NETWORKS=${suggestion(ip.address, host)} to .env.local and restart Reqora`;
}

function suggestion(address: string, host: string) {
  if (net.isIP(host)) return net.isIP(address) === 4 ? `${address.split(".").slice(0, 2).join(".")}.0.0/16` : address;
  return host;
}

let cachedPolicy: { source: string | undefined; policy: Policy } | undefined;
function currentPolicy(): Policy {
  const source = process.env.REQORA_ALLOW_NETWORKS;
  if (!cachedPolicy || cachedPolicy.source !== source) cachedPolicy = { source, policy: parsePolicy(source) };
  return cachedPolicy.policy;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

/** dns.lookup that refuses blocked addresses (every resolved address must pass). */
export function guardedLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "");
    const policy = currentPolicy();
    for (const { address } of addresses) {
      const reason = blockedReason(address, hostname, policy);
      if (reason) return callback(new OutboundBlockedError(reason), "");
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

type Origin = { host: string; port: number };
const portOf = (protocol: string | undefined, port: string | number | undefined) =>
  Number(port) || (protocol === "https:" ? 443 : 80);

function agentFor(self: Origin | undefined) {
  const plain = buildConnector({});
  const guarded = buildConnector({ lookup: guardedLookup as unknown as typeof dns.lookup });
  const connect: buildConnector.connector = (options, callback) => {
    const host = options.hostname.replace(/^\[|\]$/g, "");
    if (self && host === self.host && portOf(options.protocol, options.port) === self.port) return plain(options, callback);
    if (net.isIP(host)) {
      // IP literals skip DNS, so check them here.
      const reason = blockedReason(host, host, currentPolicy());
      if (reason) return callback(new OutboundBlockedError(reason), null);
      return plain(options, callback);
    }
    return guarded(options, callback);
  };
  return new Agent({ connect });
}

const agents = new Map<string, Agent>();

/**
 * `fetch` that enforces the outbound policy. `selfOrigin` (the Reqora server's own origin) stays reachable so
 * relative URLs keep working.
 */
export function outboundFetch(selfOrigin?: string): typeof fetch {
  let self: Origin | undefined;
  if (selfOrigin) {
    try {
      const url = new URL(selfOrigin);
      self = { host: url.hostname.replace(/^\[|\]$/g, ""), port: portOf(url.protocol, url.port) };
    } catch {
      self = undefined;
    }
  }
  const key = self ? `${self.host}:${self.port}` : "";
  let agent = agents.get(key);
  if (!agent) {
    agent = agentFor(self);
    agents.set(key, agent);
  }
  const dispatcher = agent;
  return ((input: RequestInfo | URL, init?: RequestInit) =>
    undiciFetch(input as Parameters<typeof undiciFetch>[0], {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as typeof fetch;
}

/** The most useful message from a failed fetch (undici wraps the cause in "fetch failed"). */
export function fetchErrorMessage(error: unknown): string {
  const err = error as Error & { cause?: { message?: string } };
  return err.cause?.message ?? err.message;
}
