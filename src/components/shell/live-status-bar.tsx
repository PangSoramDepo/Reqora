"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/icon";
import {
  getCanvasState,
  onCanvasState,
  onRequestSent,
  type CanvasState,
} from "@/lib/canvas-events";
import { clearRecentSends, fetchRecentSends } from "@/lib/collections/client";
import type { SendRecord } from "@/lib/collections/history";
import {
  deleteRuns,
  fetchRecentRuns,
  fetchWorkflowSummaries,
} from "@/lib/workflows/client";
import type { Run } from "@/lib/workflows/schema";
import { ExecutionConsole, type ClearMode, type ConsoleTab } from "./execution-console";

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

/**
 * "Clear" on the Workflow runs tab only hides runs from the console (they are the Execution History, used by
 * /executions and replays). Stored per view: the startedAt of the newest run at the time of clearing.
 */
const CLEARED_KEY = "reqora:console-runs-cleared";
type ClearedRuns = Record<string, string>;

function readCleared(): ClearedRuns {
  try {
    const value = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as ClearedRuns) : {};
  } catch {
    return {};
  }
}

function saveCleared(value: ClearedRuns) {
  try {
    localStorage.setItem(CLEARED_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable; the clear still applies until reload.
  }
}

const NO_CANVAS: Partial<CanvasState> = {};
const subscribeCanvas = (onChange: () => void) => onCanvasState(onChange);

type Feed = { scope: string; runs: Run[]; now: number; error: string | null };

export function LiveStatusBar({ className }: { className: string }) {
  const pathname = usePathname();
  const workflowId = /^\/flow\/([^/]+)/.exec(pathname)?.[1];
  const scope = workflowId ?? "*";

  const open = useSyncExternalStore(subscribeOpen, readOpen, () => false);
  const canvas = useSyncExternalStore(
    subscribeCanvas,
    getCanvasState,
    () => NO_CANVAS,
  );
  const onThisCanvas = !!workflowId && canvas.workflowId === workflowId;
  const running = onThisCanvas && !!canvas.running;

  const [feed, setFeed] = useState<Feed>({
    scope: "",
    runs: [],
    now: 0,
    error: null,
  });
  const [names, setNames] = useState(new Map<string, string>());
  const [sends, setSends] = useState<{ list: SendRecord[]; loaded: boolean }>({
    list: [],
    loaded: false,
  });
  const [chosenTab, setChosenTab] = useState<ConsoleTab | null>(null);
  const [cleared, setCleared] = useState<ClearedRuns>(readCleared);
  // Bumped on clear so a poll that started before it can't bring the old entries back.
  const sendsGeneration = useRef(0);
  const onCollections = pathname.startsWith("/collections");
  // Until the user picks a view, show what the current page produces.
  const tab: ConsoleTab = chosenTab ?? (onCollections ? "requests" : "runs");

  // Collections sends: polled while the console is open (or on the Collections page, for the bar's
  // latency), and refreshed the moment a send finishes.
  useEffect(() => {
    if (!open && !onCollections) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      const generation = sendsGeneration.current;
      fetchRecentSends()
        .then((list) => !cancelled && generation === sendsGeneration.current && setSends({ list, loaded: true }))
        .catch(
          () => !cancelled && setSends((prev) => ({ ...prev, loaded: true })),
        );
    };
    load();
    const timer = setInterval(load, open ? POLL_OPEN_MS : POLL_CLOSED_MS);
    const off = onRequestSent(load);
    document.addEventListener("visibilitychange", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      off();
      document.removeEventListener("visibilitychange", load);
    };
  }, [open, onCollections]);

  // Poll fast while the console is open, slowly otherwise (the bar still shows the latest run), and
  // only while the tab is visible. `running` is a dependency so a canvas test run refreshes on start/finish.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetchRecentRuns(workflowId)
        .then(
          (runs) =>
            !cancelled &&
            setFeed({ scope, runs, now: Date.now(), error: null }),
        )
        .catch(
          (error: Error) =>
            !cancelled &&
            setFeed((prev) => ({
              scope,
              runs: prev.scope === scope ? prev.runs : [],
              now: Date.now(),
              error: error.message,
            })),
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
      .then(
        (list) =>
          !cancelled && setNames(new Map(list.map((w) => [w.id, w.name]))),
      )
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open, scope]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented)
        setConsoleOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = feed.scope === scope;
  const runs = current ? feed.runs : [];
  const latest = runs[0];
  const toggle = () => setConsoleOpen(!open);

  // The console hides runs up to the cutoff for this view (a per-workflow view also honours "All workflows").
  const cutoff = [cleared[scope], scope === "*" ? undefined : cleared["*"]].filter(Boolean).sort().at(-1);
  const visibleRuns = cutoff ? runs.filter((r) => r.startedAt > cutoff) : runs;

  const clearConsole = async (mode: ClearMode) => {
    if (tab === "requests") {
      sendsGeneration.current += 1;
      await clearRecentSends();
      setSends({ list: [], loaded: true });
      return;
    }
    if (mode === "delete") {
      // Permanently delete this view's runs (one workflow, or all), then forget any hide cutoff for it.
      await deleteRuns(workflowId);
      setFeed((prev) => ({ ...prev, scope, runs: [], error: null }));
      showClearedRuns();
      return;
    }
    if (!runs[0]) return;
    const next = { ...cleared, [scope]: runs[0].startedAt };
    saveCleared(next);
    setCleared(next);
  };
  const showClearedRuns = () => {
    const next = { ...cleared };
    delete next[scope];
    if (scope !== "*") delete next["*"];
    saveCleared(next);
    setCleared(next);
  };

  return (
    <>
      {open && (
        <ExecutionConsole
          error={current ? feed.error : null}
          loading={!current}
          names={names}
          now={feed.now}
          onClose={() => setConsoleOpen(false)}
          onTab={setChosenTab}
          onClear={clearConsole}
          hiddenRuns={runs.length - visibleRuns.length}
          onShowHiddenRuns={showClearedRuns}
          runs={visibleRuns}
          sends={sends.list}
          sendsLoading={!sends.loaded}
          tab={tab}
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
                <span
                  className={`w-2 h-2 rounded-full ${latest?.status === "failed" ? "bg-error" : "bg-primary"}`}
                />
                <span
                  title={latest ? `Last run ${latest.status}` : "No runs yet"}
                >
                  READY
                </span>
              </>
            )}
            {onThisCanvas && canvas.nodeCount !== undefined && (
              <>
                <span className="text-outline">|</span>
                <span>Active Nodes: {canvas.nodeCount}</span>
              </>
            )}
            <span className="text-outline">|</span>
            {onCollections ? (
              <span
                title={
                  sends.list[0]
                    ? `Latest request “${sends.list[0].name}”`
                    : undefined
                }
              >
                Latency:{" "}
                {sends.list[0] ? (
                  <span
                    className={
                      sends.list[0].error || (sends.list[0].status ?? 0) >= 400
                        ? "text-error"
                        : undefined
                    }
                  >
                    {sends.list[0].durationMs}ms
                  </span>
                ) : (
                  "—"
                )}
              </span>
            ) : (
              <span title={latest ? `Latest run #${latest.id}` : undefined}>
                Latency:{" "}
                {latest ? (
                  <span
                    className={
                      latest.status === "failed" ? "text-error" : undefined
                    }
                  >
                    {latest.durationMs}ms
                    {latest.status === "failed" ? " (failed)" : ""}
                  </span>
                ) : (
                  "—"
                )}
              </span>
            )}
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
            <Icon
              name={open ? "unfold_less" : "unfold_more"}
              className="text-body-md"
            />
          </button>
        </div>
      </footer>
    </>
  );
}
