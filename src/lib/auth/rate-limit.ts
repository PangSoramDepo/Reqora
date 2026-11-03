import "server-only";

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

type Entry = { failures: number; first: number };

// In-memory per process: enough for a single-node deployment; use a shared store when scaling out.
const globalForLimits = globalThis as unknown as { reqoraLoginFailures?: Map<string, Entry> };
const failures = (globalForLimits.reqoraLoginFailures ??= new Map());

/** Seconds until the key may try again, or 0 if it isn't locked out. */
export function retryAfter(key: string, now = Date.now()): number {
  const entry = failures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) return 0;
  return entry.failures >= MAX_FAILURES ? Math.ceil((entry.first + WINDOW_MS - now) / 1000) : 0;
}

export function recordFailure(key: string, now = Date.now()) {
  const entry = failures.get(key);
  if (!entry || now - entry.first > WINDOW_MS) failures.set(key, { failures: 1, first: now });
  else entry.failures += 1;
}

export function clearFailures(key: string) {
  failures.delete(key);
}
