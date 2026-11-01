import { RUN_WINDOWS, type RunWindow } from "./schema";

/** Parses a `since` query value (24h | 7d | 30d) into an ISO lower bound; undefined when invalid. */
export function windowStart(value: string | null, now = Date.now()): { window: RunWindow; since: string } | undefined {
  const window = (value ?? "24h") as RunWindow;
  if (!(window in RUN_WINDOWS)) return undefined;
  return { window, since: new Date(now - RUN_WINDOWS[window] * 3_600_000).toISOString() };
}
