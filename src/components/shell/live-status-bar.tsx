"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import { getCanvasState, onCanvasState, type CanvasState } from "@/lib/canvas-events";
import { fetchRecentRuns, fetchWorkflowSummaries } from "@/lib/workflows/client";
import type { Run } from "@/lib/workflows/schema";
import { ExecutionConsole } from "./execution-console";

const OPEN_KEY = "reqora:console-open";
const OPEN_EVENT = "reqora:console-open-change";
const POLL_OPEN_MS = 2500;
const POLL_CLOSED_MS = 15000;

function readOpen() {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribeOpen(onChange: () => void) {
  window.addEventListener(OPEN_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(OPEN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function setConsoleOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Storage unavailable (private mode); the toggle still applies for this page view.
  }
  window.dispatchEvent(new Event(OPEN_EVENT));
}

const NO_CANVAS: Partial<CanvasState> = {};
const subscribeCanvas = (onChange: () => void) => onCanvasState(onChange);

type Feed = { scope: string; runs: Run[]; now: number; error: string | null };

export function LiveStatusBar({ className }: { className: string }) {
  const pathname = usePathname();
  const workflowId = /^\/flow\/([^/]+)/.exec(pathname)?.[1];
  const scope = workflowId ?? "*";

  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const canvas = useSyncExternalStore(subscribeCanvas, getCanvasState, () => NO_CANVAS);
  const onThisCanvas = !!workflowId && canvas.workflowId === workflowId;
  const running = onThisCanvas && !!canvas.running;

  const [feed, setFeed] = useState<Feed>({ scope: "", runs: [], now: 0, error: null });
  const [names, setNames] = useState(new Map<string, string>());

  // Poll fast while the console is open, slowly otherwise (the bar still shows the latest run), and
  // only while the tab is visible. `running` is a dependency so a canvas test run refreshes on start/finish.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetchRecentRuns(workflowId)
        .then((runs) => !cancelled && setFeed({ scope, runs, now: Date.now(), error: null }))
        .catch(
          (error: Error) =>
            !cancelled &&
            setFeed((prev) => ({ scope, runs: prev.scope === scope ? prev.runs : [], now: Date.now(), error: error.message })),
        );
    };
    load();
    const timer = setInterval(load, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", load);
    };
  }, [workflowId, scope, open, running]);

  // Workflow names label runs in the cross-workflow view; refreshed whenever the console opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchWorkflowSummaries()
      .then((list) => !cancelled && setNames(new Map(list.map((w) => [w.id, w.name]))))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setConsoleOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = feed.scope === scope;
  const runs = current ? feed.runs : [];
  const latest = runs[0];
  const toggle = () => setConsoleOpen(!open);

  return (
    <>
      {open && (
        <ExecutionConsole
          error={current ? feed.error : null}
          loading={!current}
          names={names}
          now={feed.now}
          onClose={() => setConsoleOpen(false)}
          runs={runs}
          workflowId={workflowId}
        />
      )}
      <footer className={className}>
        <div className="flex items-center gap-space-md min-w-0">
          <button
            aria-controls="execution-console"
            aria-expanded={open}
            className="flex items-center gap-space-xs text-primary font-body-sm text-body-sm hover:underline shrink-0"
            onClick={toggle}
            type="button"
          >
            <Icon name="terminal" className="text-body-md" />
            <span>Live Execution Console &amp; Telemetry</span>
          </button>
          <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant min-w-0">
            {running ? (
              <>
                <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
                <span className="text-tertiary">RUNNING</span>
              </>
            ) : (
              <>
                <span className={`w-2 h-2 rounded-full ${latest?.status === "failed" ? "bg-error" : "bg-primary"}`} />
                <span title={latest ? `Last run ${latest.status}` : "No runs yet"}>READY</span>
              </>
            )}
            {onThisCanvas && canvas.nodeCount !== undefined && (
              <>
                <span className="text-outline">|</span>
                <span>Active Nodes: {canvas.nodeCount}</span>
              </>
            )}
            <span className="text-outline">|</span>
            <span title={latest ? `Latest run #${latest.id}` : undefined}>
              Latency:{" "}
              {latest ? (
                <span className={latest.status === "failed" ? "text-error" : undefined}>
                  {latest.durationMs}ms{latest.status === "failed" ? " (failed)" : ""}
                </span>
              ) : (
                "—"
              )}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-outline shrink-0">
          <span>Auto-save enabled</span>
          <button
            aria-expanded={open}
            aria-label={open ? "Collapse console" : "Expand console"}
            className="text-on-surface-variant hover:text-on-surface"
            onClick={toggle}
            title={open ? "Collapse console (Esc)" : "Expand console"}
            type="button"
          >
            <Icon name={open ? "unfold_less" : "unfold_more"} className="text-body-md" />
          </button>
        </div>
      </footer>
    </>
  );
}
