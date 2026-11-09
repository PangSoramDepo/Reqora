"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Script breakpoints (line numbers), per script, kept in this browser. Keys name the script the way debug
 * recordings do, so the editor and the debugger share them: `breakpointKey(scope, name, phase)` for
 * Collections scripts, `node:<flow>:<node>` / `until:<flow>:<node>` for a flow's Script node / "repeat until".
 */

const PREFIX = "reqora:breakpoints:";
const EMPTY: number[] = [];
const cache = new Map<string, number[]>();
const listeners = new Set<() => void>();

export const breakpointKey = (scope: string, name: string, phase: "pre" | "post") => `${scope}:${name}:${phase}`;
export const nodeBreakpointKey = (workflowId: string, nodeId: string, kind: "node" | "until" = "node") => `${kind}:${workflowId}:${nodeId}`;

function read(key: string): number[] {
  const cached = cache.get(key);
  if (cached) return cached;
  let lines = EMPTY;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(parsed)) lines = parsed.filter((n): n is number => Number.isInteger(n) && n > 0);
  } catch {
    // Storage unavailable: breakpoints last for this page only.
  }
  cache.set(key, lines);
  return lines;
}

export function setBreakpoints(key: string, lines: number[]) {
  const next = [...new Set(lines)].sort((a, b) => a - b);
  const prev = read(key);
  if (prev.length === next.length && prev.every((l, i) => l === next[i])) return;
  cache.set(key, next);
  try {
    if (next.length) localStorage.setItem(PREFIX + key, JSON.stringify(next));
    else localStorage.removeItem(PREFIX + key);
  } catch {
    // Kept in memory only.
  }
  for (const l of listeners) l();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key?.startsWith(PREFIX)) {
      cache.delete(e.key.slice(PREFIX.length));
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/** A script's breakpoint lines and a setter; `key` null = no breakpoints (nothing to key them by). */
export function useBreakpoints(key: string | null): [number[], (lines: number[]) => void] {
  const lines = useSyncExternalStore(
    subscribe,
    () => (key ? read(key) : EMPTY),
    () => EMPTY,
  );
  const set = useCallback((next: number[]) => key && setBreakpoints(key, next), [key]);
  return [lines, set];
}
