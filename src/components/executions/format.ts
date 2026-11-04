import type { Run } from "@/lib/workflows/schema";

export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "Just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const utcTime = (iso: string) => `${iso.slice(11, 23)} UTC`;

export const shortId = (id: string) => `#${id}`;

/** One-line description of how a run went. */
export function summarize(run: Run) {
  if (run.error) return run.error;
  const executed = run.steps.filter((s) => s.status === "succeeded").length;
  const skipped = run.steps.length - executed;
  return `${executed} step${executed === 1 ? "" : "s"} succeeded${skipped ? `, ${skipped} skipped by branching` : ""}`;
}

export function stepCounts(run: Run) {
  const executed = run.steps.filter((s) => s.status !== "skipped").length;
  return `${executed}/${run.steps.length} ${run.status === "failed" ? "broken" : "complete"}`;
}

/** Path of a step's request URL; failed steps may record a relative or unresolved URL, shown as-is. */
export function urlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
