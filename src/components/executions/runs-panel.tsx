"use client";

import { Icon } from "@/components/icon";
import type { Run, RunTrigger } from "@/lib/workflows/schema";
import { ago, shortId, stepCounts, summarize } from "./format";

export type StatusFilter = Run["status"] | "all";
export type TriggerFilter = RunTrigger["source"] | "all";

const STATUS_STYLES: Record<Run["status"], { dot: string; badge: string; label: string; steps: string; summary: string }> = {
  failed: {
    dot: "bg-error",
    badge: "bg-error-container text-on-error-container",
    label: "FAILED",
    steps: "text-error font-medium",
    summary: "text-error",
  },
  succeeded: {
    dot: "bg-primary",
    badge: "bg-surface-container-highest text-primary",
    label: "OK",
    steps: "text-primary",
    summary: "text-on-surface-variant",
  },
};

const TRIGGER_STYLES: Record<RunTrigger["source"], { icon: string; label: string; className: string }> = {
  webhook: { icon: "webhook", label: "Webhook", className: "text-tertiary" },
  manual: { icon: "terminal", label: "Manual", className: "text-secondary" },
  flow: { icon: "account_tree", label: "Called", className: "text-secondary-fixed-dim" },
};

const SELECT_CLASS =
  "bg-surface-container-lowest text-on-surface font-body-sm text-body-sm px-space-xs py-space-xxs rounded focus:outline-none cursor-pointer";

type RunsPanelProps = {
  runs: Run[];
  workflowNames: Map<string, string>;
  now: number;
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  status: StatusFilter;
  onStatus: (s: StatusFilter) => void;
  trigger: TriggerFilter;
  onTrigger: (t: TriggerFilter) => void;
  autoRefresh: boolean;
  onAutoRefresh: (on: boolean) => void;
};

export function RunsPanel(props: RunsPanelProps) {
  const { runs, workflowNames, now, loading, selectedId, onSelect } = props;

  return (
    <div className="lg:col-span-5 flex flex-col gap-space-xs bg-surface-container-low rounded-lg p-space-sm shadow-md">
      <div className="flex flex-col gap-space-xs pb-space-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Executions</span>
            <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest text-primary font-mono">
              {props.autoRefresh ? "LIVE_STREAM" : "PAUSED"}
            </span>
          </div>
          <button
            aria-pressed={props.autoRefresh}
            className={`flex items-center gap-space-xxs font-label-sm text-label-sm hover:underline ${
              props.autoRefresh ? "text-primary" : "text-outline"
            }`}
            onClick={() => props.onAutoRefresh(!props.autoRefresh)}
            type="button"
          >
            <Icon
              name={props.autoRefresh ? "sync" : "sync_disabled"}
              className={`text-body-md ${loading && props.autoRefresh ? "animate-spin" : ""}`}
            />{" "}
            Auto-refresh
          </button>
        </div>

        <div className="flex items-center gap-space-xs flex-wrap pt-space-xxs">
          <div className="relative flex-1 min-w-[140px]">
            <input
              aria-label="Filter runs"
              className="w-full bg-surface-container-lowest text-on-surface font-body-sm text-body-sm pl-7 pr-space-xs py-space-xxs rounded focus:outline-none focus:bg-surface-container-highest transition-colors"
              onChange={(e) => props.onQuery(e.target.value)}
              placeholder="Filter run ID, workflow, error..."
              type="text"
              value={props.query}
            />
            <Icon name="search" className="text-outline text-body-md absolute left-2 top-1.5 pointer-events-none" />
          </div>
          <select
            aria-label="Filter by status"
            className={SELECT_CLASS}
            onChange={(e) => props.onStatus(e.target.value as StatusFilter)}
            value={props.status}
          >
            <option value="all">All Statuses</option>
            <option value="succeeded">Succeeded</option>
            <option value="failed">Failed</option>
          </select>
          <select
            aria-label="Filter by trigger"
            className={SELECT_CLASS}
            onChange={(e) => props.onTrigger(e.target.value as TriggerFilter)}
            value={props.trigger}
          >
            <option value="all">All Triggers</option>
            <option value="webhook">Webhook</option>
            <option value="manual">Manual</option>
            <option value="flow">Called by a flow</option>
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-space-xxs overflow-y-auto max-h-[750px] pr-space-xxs">
        {runs.map((run) => (
          <RunItem
            key={run.id}
            run={run}
            workflowName={workflowNames.get(run.workflowId) ?? run.workflowId}
            now={now}
            selected={run.id === selectedId}
            onSelect={() => onSelect(run.id)}
          />
        ))}
        {runs.length === 0 && (
          <div className="p-space-sm rounded-lg bg-surface-container text-outline font-body-sm text-body-sm text-center">
            {loading ? "Loading runs…" : "No executions in this window match the current filters."}
          </div>
        )}
      </div>
    </div>
  );
}

function RunItem({
  run,
  workflowName,
  now,
  selected,
  onSelect,
}: {
  run: Run;
  workflowName: string;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const s = STATUS_STYLES[run.status];
  const t = TRIGGER_STYLES[run.trigger.source];

  return (
    <div
      aria-pressed={selected}
      className={`cursor-pointer p-space-sm rounded-lg text-on-surface transition-all shadow-sm group ${
        selected ? "bg-surface-container-high" : "bg-surface-container hover:bg-surface-container-high"
      }`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="flex items-center justify-between gap-space-xs">
        <div className="flex items-center gap-space-xs min-w-0">
          <span className={`w-2 h-2 shrink-0 rounded-full ${s.dot}`} />
          <span
            className={`font-label-md text-label-md font-mono font-semibold truncate ${selected ? "text-primary" : "text-on-surface"}`}
          >
            {shortId(run.id)}
          </span>
          <span className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm font-mono font-bold shrink-0 ${s.badge}`}>
            {s.label}
          </span>
          {run.replayOf && (
            <span className="px-space-xs py-space-xxs rounded font-label-sm text-label-sm font-mono bg-secondary-container text-on-secondary-container shrink-0">
              REPLAY
            </span>
          )}
        </div>
        <span className="font-label-sm text-label-sm text-outline font-mono shrink-0">{ago(run.startedAt, now)}</span>
      </div>
      <div
        className={`grid grid-cols-3 gap-space-xs mt-space-xs pt-space-xs p-space-xs rounded ${
          selected ? "bg-surface-container-lowest/60" : "bg-surface-container-lowest/40"
        }`}
      >
        <div>
          <span className="block font-label-sm text-label-sm text-outline">Trigger</span>
          <span className={`font-body-sm text-body-sm flex items-center gap-space-xxs ${t.className}`}>
            <Icon name={t.icon} className="text-[13px]" />
            {t.label}
          </span>
        </div>
        <div>
          <span className="block font-label-sm text-label-sm text-outline">Duration</span>
          <span className="font-body-sm text-body-sm font-mono text-on-surface">{run.durationMs}ms</span>
        </div>
        <div>
          <span className="block font-label-sm text-label-sm text-outline">Steps Run</span>
          <span className={`font-body-sm text-body-sm font-mono ${s.steps}`}>{stepCounts(run)}</span>
        </div>
      </div>
      <div className="mt-space-xxs flex items-center justify-between gap-space-xs text-outline">
        <span className={`font-body-sm text-body-sm truncate ${s.summary}`}>
          <span className="text-outline">{workflowName} · </span>
          {summarize(run)}
        </span>
        <Icon
          name="chevron_right"
          className={`text-body-md group-hover:translate-x-0.5 transition-transform ${
            selected ? "text-primary" : "text-on-surface-variant"
          }`}
        />
      </div>
    </div>
  );
}
