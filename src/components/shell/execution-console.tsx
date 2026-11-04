"use client";

import Link from "next/link";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { ago, shortId, summarize, utcTime } from "@/components/executions/format";
import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import type { Run, Step } from "@/lib/workflows/schema";

const HEIGHT_KEY = "reqora:console-height";
const DEFAULT_HEIGHT = 320;
const MIN_HEIGHT = 160;
/** Top bar (3.5rem) + status bar (2.5rem): the console never grows over the top bar. */
const CHROME_PX = 96;
const FULL_HEIGHT = "calc(100vh - 6rem)";

function readHeight() {
  try {
    const value = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(value) && value >= MIN_HEIGHT ? value : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

function saveHeight(height: number) {
  try {
    localStorage.setItem(HEIGHT_KEY, String(Math.round(height)));
  } catch {
    // Storage unavailable; the size still applies until reload.
  }
}

const RUN_STATUS: Record<Run["status"], { dot: string; badge: string; label: string }> = {
  succeeded: { dot: "bg-primary", badge: "bg-surface-container-highest text-primary", label: "OK" },
  failed: { dot: "bg-error", badge: "bg-error-container text-on-error-container", label: "FAILED" },
};

const STEP_STATUS: Record<Step["status"], { text: string; label: string }> = {
  succeeded: { text: "text-primary", label: "OK" },
  failed: { text: "text-error font-bold", label: "FAIL" },
  skipped: { text: "text-outline", label: "SKIP" },
};

const TRIGGER: Record<Run["trigger"]["source"], { icon: string; label: string; className: string }> = {
  webhook: { icon: "webhook", label: "Webhook", className: "text-tertiary" },
  manual: { icon: "terminal", label: "Manual", className: "text-secondary" },
};

const ICON_BUTTON = "p-space-xxs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors";

/** One-line preview of a step's output (or HTTP response body). */
function preview(step: Step): string {
  if (step.output === undefined) return "";
  const out = step.output as { status?: number; body?: unknown } | null;
  const value = out && typeof out === "object" && "body" in out ? out.body : step.output;
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

type ExecutionConsoleProps = {
  workflowId: string | undefined;
  runs: Run[];
  names: Map<string, string>;
  now: number;
  loading: boolean;
  error: string | null;
  onClose: () => void;
};

export function ExecutionConsole({ workflowId, runs, names, now, loading, error, onClose }: ExecutionConsoleProps) {
  const [height, setHeight] = useState(readHeight);
  const [expanded, setExpanded] = useState(false);
  const [pinnedId, setPinnedId] = useState<string | null>(null);

  // Follows the newest run until the user picks one (and keeps following if that one ages out).
  const selected = runs.find((r) => r.id === pinnedId) ?? runs[0];
  const scopeName = workflowId ? (names.get(workflowId) ?? workflowId) : "All workflows";

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const max = window.innerHeight - CHROME_PX;
    let next = height;
    const move = (e: PointerEvent) => {
      next = Math.min(max, Math.max(MIN_HEIGHT, window.innerHeight - 40 - e.clientY));
      setExpanded(false);
      setHeight(next);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      saveHeight(next);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <section
      aria-label="Live execution console"
      className="fixed left-64 right-0 bottom-10 z-40 flex flex-col bg-surface-container-low/98 backdrop-blur-xl shadow-[0_-4px_16px_rgba(0,0,0,0.35)] overscroll-contain"
      id="execution-console"
      style={{ height: expanded ? FULL_HEIGHT : height, maxHeight: FULL_HEIGHT }}
    >
      <div
        aria-label="Resize console"
        aria-orientation="horizontal"
        className="absolute -top-1 left-0 right-0 h-2 cursor-ns-resize group z-10"
        onDoubleClick={() => setExpanded((v) => !v)}
        onPointerDown={startResize}
        role="separator"
      >
        <span className="block mx-auto mt-0.5 h-1 w-10 rounded-full bg-outline-variant group-hover:bg-primary transition-colors" />
      </div>

      <header className="flex items-center justify-between gap-space-sm px-space-md h-10 shrink-0 bg-surface-container">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="terminal" className="text-primary text-body-md" />
          <span className="font-label-md text-label-md text-on-surface font-semibold">Live Execution Console</span>
          <span
            className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest text-on-surface-variant truncate max-w-64"
            title={workflowId ? `Runs of ${scopeName}` : "Recent runs across all workflows (last 30 days)"}
          >
            {workflowId ? scopeName : "All workflows"}
          </span>
          <span className="flex items-center gap-space-xxs font-label-sm text-label-sm text-primary font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" /> LIVE
          </span>
          {error && (
            <span className="font-label-sm text-label-sm text-error truncate" title={error}>
              {error}
            </span>
          )}
        </div>
        <div className="flex items-center gap-space-xs shrink-0">
          <Link
            className="flex items-center gap-space-xxs font-label-sm text-label-sm text-primary hover:underline px-space-xs"
            href="/executions"
          >
            View in Executions <Icon name="open_in_new" className="text-body-md" />
          </Link>
          <button
            aria-label={expanded ? "Restore console size" : "Maximize console"}
            className={ICON_BUTTON}
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Restore" : "Maximize"}
            type="button"
          >
            <Icon name={expanded ? "close_fullscreen" : "open_in_full"} className="text-body-md" />
          </button>
          <button aria-label="Close console" className={ICON_BUTTON} onClick={onClose} title="Close (Esc)" type="button">
            <Icon name="close" className="text-body-md" />
          </button>
        </div>
      </header>

      {runs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-space-xs text-outline font-body-sm text-body-sm p-space-md text-center">
          {loading ? (
            <>
              <Icon name="progress_activity" className="animate-spin text-headline-sm" /> Loading runs…
            </>
          ) : (
            <>
              <Icon name="history" className="text-headline-md" />
              <span className="text-on-surface-variant">No runs yet</span>
              <span>
                {workflowId
                  ? "Press Run in the top bar to test this workflow — its steps stream in here."
                  : "Webhook calls and canvas test runs from the last 30 days appear here."}
              </span>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <ul className="w-80 shrink-0 overflow-y-auto overscroll-contain bg-surface-container-lowest/40 p-space-xs flex flex-col gap-space-xxs">
            {runs.map((run) => (
              <li key={run.id}>
                <RunRow
                  now={now}
                  onSelect={() => setPinnedId(run.id)}
                  run={run}
                  selected={run.id === selected?.id}
                  workflowName={workflowId ? undefined : (names.get(run.workflowId) ?? run.workflowId)}
                />
              </li>
            ))}
          </ul>
          {selected && <StepLog run={selected} workflowName={names.get(selected.workflowId)} />}
        </div>
      )}
    </section>
  );
}

function RunRow({
  run,
  workflowName,
  now,
  selected,
  onSelect,
}: {
  run: Run;
  workflowName: string | undefined;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = RUN_STATUS[run.status];
  const t = TRIGGER[run.trigger.source];
  return (
    <button
      aria-pressed={selected}
      className={`w-full text-left rounded px-space-sm py-space-xs transition-colors ${
        selected ? "bg-surface-container-high" : "hover:bg-surface-container"
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex items-center gap-space-xs">
        <span className={`w-2 h-2 shrink-0 rounded-full ${s.dot}`} />
        <span className={`font-label-md text-label-md font-mono truncate ${selected ? "text-primary" : "text-on-surface"}`}>
          {shortId(run.id)}
        </span>
        <span className={`px-space-xs rounded font-label-sm text-label-sm font-mono font-bold shrink-0 ${s.badge}`}>{s.label}</span>
        <span className="ml-auto font-label-sm text-label-sm text-outline font-mono shrink-0">{ago(run.startedAt, now)}</span>
      </div>
      <div className="mt-space-xxs flex items-center gap-space-sm font-label-sm text-label-sm text-outline">
        <span className={`flex items-center gap-space-xxs ${t.className}`}>
          <Icon name={t.icon} className="text-[13px]" />
          {t.label}
        </span>
        <span className="font-mono text-on-surface-variant">{run.durationMs}ms</span>
        {workflowName && <span className="truncate">{workflowName}</span>}
      </div>
    </button>
  );
}

function StepLog({ run, workflowName }: { run: Run; workflowName: string | undefined }) {
  const s = RUN_STATUS[run.status];
  const env = ENVIRONMENT_LABELS[run.environment];
  const start = Date.parse(run.startedAt);

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className="flex items-center gap-space-sm flex-wrap px-space-md py-space-xs shrink-0 font-label-sm text-label-sm text-outline">
        <span className="font-label-md text-label-md font-mono text-on-surface font-semibold">{shortId(run.id)}</span>
        <span className={`px-space-xs rounded font-mono font-bold ${s.badge}`}>{s.label}</span>
        {run.replayOf && <span className="px-space-xs rounded font-mono bg-secondary-container text-on-secondary-container">REPLAY</span>}
        {workflowName && <span className="text-on-surface-variant">{workflowName}</span>}
        <span className={env.tone}>{env.label}</span>
        <span className="font-mono">v{run.workflowVersion}</span>
        <span className="font-mono">{utcTime(run.startedAt)}</span>
        <span className="font-mono text-on-surface-variant">{run.durationMs}ms</span>
        <span className={`truncate ${run.status === "failed" ? "text-error" : ""}`}>{summarize(run)}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-auto overscroll-contain px-space-md pb-space-sm">
        <table className="w-full font-mono font-label-sm text-label-sm border-separate border-spacing-y-0.5">
          <thead className="text-outline text-left">
            <tr>
              <th className="font-normal py-space-xxs pr-space-sm w-16">+t</th>
              <th className="font-normal py-space-xxs pr-space-sm">Node</th>
              <th className="font-normal py-space-xxs pr-space-sm w-14">Status</th>
              <th className="font-normal py-space-xxs pr-space-sm w-16 text-right">Duration</th>
              <th className="font-normal py-space-xxs">Detail</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((step) => {
              const st = STEP_STATUS[step.status];
              const detail = step.error ?? preview(step);
              const request = step.request ? `${step.request.method} ${step.request.url}` : "";
              return (
                <tr key={step.nodeId} className={`align-top ${step.status === "failed" ? "bg-error-container/20" : "bg-surface-container/60"}`}>
                  <td className="py-space-xxs px-space-xs rounded-l text-outline whitespace-nowrap">
                    +{Math.max(0, Date.parse(step.startedAt) - start)}ms
                  </td>
                  <td className="py-space-xxs pr-space-sm text-on-surface whitespace-nowrap">
                    {step.name} <span className="text-outline">· {step.nodeType}</span>
                    {step.port && <span className="text-secondary"> → {step.port}</span>}
                  </td>
                  <td className={`py-space-xxs pr-space-sm ${st.text}`}>{st.label}</td>
                  <td className="py-space-xxs pr-space-sm text-right text-on-surface-variant whitespace-nowrap">
                    {step.status === "skipped" ? "—" : `${step.durationMs}ms`}
                  </td>
                  <td className="py-space-xxs pr-space-xs rounded-r max-w-0 w-full">
                    {request && (
                      <span className="block truncate text-on-surface-variant" title={request}>
                        {request}
                      </span>
                    )}
                    {detail && (
                      <span className={`block truncate ${step.error ? "text-error" : "text-outline"}`} title={detail}>
                        {detail}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
