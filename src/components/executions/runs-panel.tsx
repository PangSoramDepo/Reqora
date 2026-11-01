"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import {
  RUNS,
  STATUS_FILTERS,
  TRIGGER_FILTERS,
  type Run,
  type RunStatus,
  type RunTrigger,
} from "./data";

const STATUS_STYLES: Record<
  RunStatus,
  { dot: string; badge: string; steps: string; duration: string; summary: string }
> = {
  "500": {
    dot: "bg-error animate-ping",
    badge: "bg-error-container text-on-error-container",
    steps: "text-error font-medium",
    duration: "text-on-surface",
    summary: "text-error",
  },
  "200": {
    dot: "bg-primary",
    badge: "bg-surface-container-highest text-primary",
    steps: "text-primary",
    duration: "text-on-surface",
    summary: "text-on-surface-variant",
  },
  RUNNING: {
    dot: "bg-tertiary animate-pulse",
    badge: "bg-tertiary-container text-on-tertiary-container",
    steps: "text-on-surface",
    duration: "text-tertiary",
    summary: "text-on-surface-variant",
  },
  RETRIED: {
    dot: "bg-secondary",
    badge: "bg-secondary-container text-on-secondary-container",
    steps: "text-primary",
    duration: "text-on-surface",
    summary: "text-on-surface-variant",
  },
};

const TRIGGER_STYLES: Record<RunTrigger, { icon: string; label: string; className: string }> = {
  Webhook: { icon: "webhook", label: "Webhook", className: "text-tertiary" },
  "Manual Test": { icon: "terminal", label: "Manual", className: "text-secondary" },
  "Scheduled Cron": { icon: "alarm", label: "Cron", className: "text-on-surface" },
};

const SELECT_CLASS =
  "bg-surface-container-lowest text-on-surface font-body-sm text-body-sm px-space-xs py-space-xxs rounded focus:outline-none cursor-pointer";

export function RunsPanel() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<RunStatus | "all">("all");
  const [trigger, setTrigger] = useState<RunTrigger | "all">("all");
  const [selectedId, setSelectedId] = useState(RUNS[0].id);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const needle = query.trim().toLowerCase();
  const runs = RUNS.filter(
    (run) =>
      (status === "all" || run.status === status) &&
      (trigger === "all" || run.trigger === trigger) &&
      (needle === "" ||
        [run.id, run.summary, run.trigger, run.statusLabel].some((f) =>
          f.toLowerCase().includes(needle),
        )),
  );

  return (
    <div className="lg:col-span-5 flex flex-col gap-space-xs bg-surface-container-low rounded-lg p-space-sm shadow-md">
      {/* Filter Bar & Search */}
      <div className="flex flex-col gap-space-xs pb-space-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Executions</span>
            <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest text-primary font-mono">
              LIVE_STREAM
            </span>
          </div>
          <div className="flex items-center gap-space-xs">
            <button
              aria-pressed={autoRefresh}
              className={`flex items-center gap-space-xxs font-label-sm text-label-sm hover:underline ${
                autoRefresh ? "text-primary" : "text-outline"
              }`}
              onClick={() => setAutoRefresh((v) => !v)}
              type="button"
            >
              <Icon name={autoRefresh ? "sync" : "sync_disabled"} className="text-body-md" /> Auto-refresh
            </button>
          </div>
        </div>

        {/* Filter Pill Chips */}
        <div className="flex items-center gap-space-xs flex-wrap pt-space-xxs">
          <div className="relative flex-1 min-w-[140px]">
            <input
              aria-label="Filter runs"
              className="w-full bg-surface-container-lowest text-on-surface font-body-sm text-body-sm pl-7 pr-space-xs py-space-xxs rounded focus:outline-none focus:bg-surface-container-highest transition-colors"
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter ID, IP, tag..."
              type="text"
              value={query}
            />
            <Icon
              name="search"
              className="text-outline text-body-md absolute left-2 top-1.5 pointer-events-none"
            />
          </div>
          <select
            aria-label="Filter by status"
            className={SELECT_CLASS}
            onChange={(e) => setStatus(e.target.value as RunStatus | "all")}
            value={status}
          >
            {STATUS_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by trigger"
            className={SELECT_CLASS}
            onChange={(e) => setTrigger(e.target.value as RunTrigger | "all")}
            value={trigger}
          >
            {TRIGGER_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Execution Runs List */}
      <div className="flex flex-col gap-space-xxs overflow-y-auto max-h-[750px] pr-space-xxs">
        {runs.map((run) => (
          <RunItem
            key={run.id}
            run={run}
            selected={run.id === selectedId}
            onSelect={() => setSelectedId(run.id)}
          />
        ))}
        {runs.length === 0 && (
          <div className="p-space-sm rounded-lg bg-surface-container text-outline font-body-sm text-body-sm text-center">
            No executions match the current filters.
          </div>
        )}
      </div>
    </div>
  );
}

function RunItem({ run, selected, onSelect }: { run: Run; selected: boolean; onSelect: () => void }) {
  const s = STATUS_STYLES[run.status];
  const t = TRIGGER_STYLES[run.trigger];

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <span className={`w-2 h-2 rounded-full ${s.dot}`} />
          <span
            className={`font-label-md text-label-md font-mono font-semibold ${
              selected ? "text-primary" : "text-on-surface"
            }`}
          >
            {run.id}
          </span>
          <span className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm font-mono font-bold ${s.badge}`}>
            {run.statusLabel}
          </span>
        </div>
        <span className="font-label-sm text-label-sm text-outline font-mono">{run.ago}</span>
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
          <span className={`font-body-sm text-body-sm font-mono ${s.duration}`}>{run.duration}</span>
        </div>
        <div>
          <span className="block font-label-sm text-label-sm text-outline">Steps Run</span>
          <span className={`font-body-sm text-body-sm font-mono ${s.steps}`}>{run.steps}</span>
        </div>
      </div>
      <div className="mt-space-xxs flex items-center justify-between text-outline">
        <span className={`font-body-sm text-body-sm truncate ${s.summary}`}>{run.summary}</span>
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
