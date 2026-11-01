"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { FLOW_RUNS, TONE_CLASSES, TOTAL_LOGGED_RUNS, type CircuitControl, type FlowRun, type RunAction } from "./data";

const STATUS_FILTERS = ["All Statuses", "Successful", "Failed"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const TD = "py-space-sm px-space-md";
const HEADERS = [
  "Run Trace ID",
  "Timestamp",
  "Flow Target",
  "Duration",
  "Status",
  "Failing Node / Message",
  "Circuit Breaker",
];

export function LiveRunsTable() {
  const [paused, setPaused] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All Statuses");

  const q = query.trim().toLowerCase();
  const runs = FLOW_RUNS.filter((run) => {
    if (statusFilter === "Successful" && !run.ok) return false;
    if (statusFilter === "Failed" && run.ok) return false;
    if (!q) return true;
    return [run.id, run.flow, run.status, run.failure?.node, run.failure?.message, run.note]
      .filter(Boolean)
      .some((field) => field!.toLowerCase().includes(q));
  });

  const cycleStatusFilter = () =>
    setStatusFilter((current) => STATUS_FILTERS[(STATUS_FILTERS.indexOf(current) + 1) % STATUS_FILTERS.length]);

  return (
    <div className="bg-surface-container-low rounded-xl shadow-md overflow-hidden">
      {/* Table Header & Controls */}
      <div className="p-space-md bg-surface-container-low flex flex-wrap items-center justify-between gap-space-sm">
        <div className="flex items-center gap-space-sm">
          <div className={`w-2.5 h-2.5 rounded-full bg-primary ${paused ? "opacity-40" : "animate-ping"}`} />
          <div>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Real-Time Flow Invocations</h2>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Live streaming execution payloads with quick retry &amp; per-node circuit breaker controls
            </p>
          </div>
        </div>
        {/* Filter & Search Controls */}
        <div className="flex items-center gap-space-xs">
          <button
            type="button"
            onClick={cycleStatusFilter}
            className="flex items-center gap-space-xs bg-surface-container px-space-sm py-space-xxs rounded text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <Icon name="filter_alt" className="text-body-md" />
            <span className="font-body-sm text-body-sm">{statusFilter}</span>
          </button>
          <label className="flex items-center gap-space-xs bg-surface-container px-space-sm py-space-xxs rounded text-on-surface-variant">
            <Icon name="search" className="text-body-md" />
            <input
              className="bg-transparent text-on-surface font-body-sm text-body-sm outline-none w-44 placeholder:text-outline"
              placeholder="Filter Run ID, Trace..."
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={paused}
            className={`flex items-center gap-space-xxs px-space-sm py-space-xxs hover:bg-surface-container-highest text-on-surface rounded font-body-sm text-body-sm transition-colors ${
              paused ? "bg-surface-bright" : "bg-surface-container-high"
            }`}
          >
            {paused ? (
              <>
                <Icon name="play_arrow" className="text-body-md text-primary" />
                <span>Resume Stream</span>
              </>
            ) : (
              <>
                <Icon name="pause" className="text-body-md" />
                <span>Pause Stream</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Execution Runs Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left font-body-sm text-body-sm">
          <thead className="bg-surface-container-lowest/80 text-on-surface-variant uppercase font-label-sm text-label-sm tracking-wider">
            <tr>
              {HEADERS.map((h) => (
                <th key={h} className={TD}>
                  {h}
                </th>
              ))}
              <th className={`${TD} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y-0 text-on-surface">
            {runs.map((run, i) => (
              <RunRow key={run.id} run={run} striped={i % 2 === 1} />
            ))}
            {runs.length === 0 && (
              <tr className="bg-surface-container-low">
                <td colSpan={HEADERS.length + 1} className={`${TD} text-center text-outline`}>
                  No executions match the current filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Table Bottom Metadata Pagination */}
      <div className="px-space-md py-space-xs bg-surface-container-lowest/90 flex flex-wrap items-center justify-between font-label-sm text-label-sm text-outline">
        <div className="flex items-center gap-space-xs">
          <span>
            Displaying {runs.length} of {TOTAL_LOGGED_RUNS} executions logged in memory
          </span>
          <span className="text-on-surface-variant">| Buffer: 98% healthy</span>
        </div>
        <div className="flex items-center gap-space-sm">
          <span>Auto-purge in: 2h 14m</span>
          <div className="flex items-center gap-space-xxs">
            <button
              type="button"
              className="p-space-xxs text-on-surface hover:bg-surface-container rounded disabled:opacity-40"
              disabled
            >
              <Icon name="chevron_left" className="text-body-sm" />
            </button>
            <span className="px-space-xs text-on-surface font-semibold">1</span>
            <button type="button" className="p-space-xxs text-on-surface hover:bg-surface-container rounded">
              <Icon name="chevron_right" className="text-body-sm" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RunRow({ run, striped }: { run: FlowRun; striped: boolean }) {
  return (
    <tr
      className={`hover:bg-surface-container-high/40 transition-colors ${
        striped ? "bg-surface-container-low/50" : "bg-surface-container-low"
      }`}
    >
      <td className={`${TD} font-code-block text-code-block text-primary font-medium`}>
        <div className="flex items-center gap-space-xxs">
          <Icon name={run.icon} className={run.iconClass ? `text-body-sm ${run.iconClass}` : "text-body-sm"} />
          <span>{run.id}</span>
        </div>
      </td>
      <td className={`${TD} text-outline`}>{run.timestamp}</td>
      <td className={`${TD} font-medium`}>{run.flow}</td>
      <td className={`${TD} ${run.durationClass} font-semibold`}>{run.duration}</td>
      <td className={TD}>
        <span className={`px-space-xs py-space-xxs ${run.statusClass} rounded font-label-sm text-label-sm font-semibold`}>
          {run.status}
        </span>
      </td>
      {run.failure ? (
        <td className={`${TD} text-on-surface-variant`}>
          <div className="flex items-center gap-space-xs">
            <span className={`w-1.5 h-1.5 rounded-full ${TONE_CLASSES[run.failure.tone].dot}`} />
            <span className={`font-code-block text-code-block ${TONE_CLASSES[run.failure.tone].text}`}>
              {run.failure.node}
            </span>
            <span className="truncate max-w-xs text-outline">{run.failure.message}</span>
          </div>
        </td>
      ) : (
        <td className={`${TD} text-outline`}>
          <span>{run.note}</span>
        </td>
      )}
      <td className={TD}>
        <CircuitCell circuit={run.circuit} />
      </td>
      <td className={`${TD} text-right`}>
        <div className="flex items-center justify-end gap-space-xs">
          <ActionButton action={run.action} />
          <button type="button" className="p-space-xxs text-on-surface-variant hover:text-on-surface" aria-label="More actions">
            <Icon name="more_vert" className="text-body-md" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function CircuitCell({ circuit }: { circuit: CircuitControl }) {
  if (circuit.kind === "closed") {
    return (
      <span className="px-space-xs py-space-xxs rounded bg-surface-container-highest text-on-surface-variant font-label-sm text-label-sm">
        CLOSED (OK)
      </span>
    );
  }
  const toggle = <CircuitToggle circuit={circuit} />;
  if (!circuit.autoBypassNote) return toggle;
  return (
    <div className="flex items-center gap-space-xs">
      {toggle}
      <span className="font-label-sm text-label-sm text-outline">{circuit.autoBypassNote}</span>
    </div>
  );
}

type ToggleCircuit = Extract<CircuitControl, { kind: "toggle" }>;

function CircuitToggle({ circuit }: { circuit: ToggleCircuit }) {
  const [tripped, setTripped] = useState(circuit.initiallyTripped);
  // Once a tripped breaker has been reset, it shows the generic RESET state.
  const [wasReset, setWasReset] = useState(false);

  const onClick = () => {
    if (tripped) setWasReset(true);
    setTripped((t) => !t);
  };

  const base = "px-space-xs py-space-xxs rounded font-label-sm text-label-sm flex items-center gap-space-xxs";
  if (tripped) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed
        className={`${base} bg-error text-on-error font-bold hover:opacity-90 transition-opacity`}
      >
        <Icon name="flash_off" className="text-body-sm" />
        <span>TRIPPED</span>
      </button>
    );
  }

  const icon = wasReset ? "power_settings_new" : circuit.icon;
  const iconClass = wasReset ? "text-primary" : circuit.iconClass;
  const label = wasReset ? "RESET" : circuit.label;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={false}
      className={`${base} bg-surface-container-highest text-on-surface hover:bg-surface-bright font-medium transition-colors`}
    >
      <Icon name={icon} className={`text-body-sm ${iconClass}`} />
      <span>{label}</span>
    </button>
  );
}

function ActionButton({ action }: { action: RunAction }) {
  if (action.kind === "inspect") {
    return (
      <button
        type="button"
        className="px-space-sm py-space-xxs bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant rounded font-label-sm text-label-sm flex items-center gap-space-xxs transition-colors"
      >
        <Icon name="visibility" className="text-body-sm" />
        <span>Inspect</span>
      </button>
    );
  }
  return <RetryButton label={action.label} icon={action.icon} />;
}

type RetryPhase = "idle" | "retrying" | "queued";

function RetryButton({ label, icon }: { label: string; icon: string }) {
  const [phase, setPhase] = useState<RetryPhase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const onClick = () => {
    if (phase !== "idle") return;
    setPhase("retrying");
    timers.current.push(
      setTimeout(() => {
        setPhase("queued");
        timers.current.push(setTimeout(() => setPhase("idle"), 2000));
      }, 1200),
    );
  };

  const colors = phase === "retrying" ? "bg-primary text-on-primary" : "bg-surface-container-highest text-primary";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-busy={phase === "retrying"}
      className={`px-space-sm py-space-xxs ${colors} hover:bg-surface-bright rounded font-label-sm text-label-sm flex items-center gap-space-xxs transition-colors`}
    >
      {phase === "retrying" ? (
        <>
          <Icon name="refresh" className="text-body-sm animate-spin" />
          <span>Retrying...</span>
        </>
      ) : phase === "queued" ? (
        <>
          <Icon name="done" className="text-body-sm" />
          <span>Queued</span>
        </>
      ) : (
        <>
          <Icon name={icon} className="text-body-sm" />
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
