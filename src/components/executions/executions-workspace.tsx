"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  fetchRunStats,
  fetchRuns,
  fetchWorkflowSummaries,
  replayRun,
  type RunStatsResponse,
} from "@/lib/workflows/client";
import type { Run, RunWindow } from "@/lib/workflows/schema";
import { RunInspector } from "./run-inspector";
import { RunsPanel, type StatusFilter, type TriggerFilter } from "./runs-panel";
import { TimeRangePicker } from "./time-range-picker";

const POLL_MS = 5000;

type Metric = {
  label: string;
  value: string;
  valueClass: string;
  note: string;
  noteClass: string;
  icon: string;
  iconWrapClass: string;
};

function metrics(stats: RunStatsResponse | null, window: RunWindow): Metric[] {
  const pct = stats?.successRate == null ? "—" : `${(stats.successRate * 100).toFixed(1)}%`;
  return [
    {
      label: `Runs (Last ${window})`,
      value: stats ? stats.total.toLocaleString() : "—",
      valueClass: "text-on-surface",
      note: stats ? `${stats.succeeded} ok` : "",
      noteClass: "text-primary",
      icon: "cycle",
      iconWrapClass: "bg-primary/10 text-primary",
    },
    {
      label: "Success Rate",
      value: pct,
      valueClass: "text-primary",
      note: stats?.total ? `/ ${stats.failed} failed` : "no runs yet",
      noteClass: "text-outline",
      icon: "verified",
      iconWrapClass: "bg-primary/10 text-primary",
    },
    {
      label: "Avg Latency",
      value: stats?.avgDurationMs == null ? "—" : `${stats.avgDurationMs}ms`,
      valueClass: "text-secondary",
      note: stats?.p95DurationMs == null ? "" : `p95: ${stats.p95DurationMs}ms`,
      noteClass: "text-outline",
      icon: "speed",
      iconWrapClass: "bg-secondary-container/20 text-secondary",
    },
    {
      label: "Failed Runs",
      value: stats ? String(stats.failed) : "—",
      valueClass: stats?.failed ? "text-error" : "text-on-surface",
      note: stats?.failed ? "needs attention" : "all clear",
      noteClass: stats?.failed
        ? "text-error bg-error-container/40 px-space-xs py-space-xxs rounded"
        : "text-outline",
      icon: "error_circle_rounded",
      iconWrapClass: "bg-error-container/20 text-error",
    },
  ];
}

export function ExecutionsWorkspace() {
  const [window, setWindow] = useState<RunWindow>("24h");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [trigger, setTrigger] = useState<TriggerFilter>("all");
  const [query, setQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [runs, setRuns] = useState<Run[]>([]);
  const [stats, setStats] = useState<RunStatsResponse | null>(null);
  const [names, setNames] = useState(new Map<string, string>());
  // `?run=<id>` (e.g. from Telemetry's Inspect) preselects that run.
  const params = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => params.get("run"));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [now, setNow] = useState(0);

  // Bumped to force an immediate reload (e.g. after a replay).
  const [reloadKey, setReloadKey] = useState(0);

  // `loading` only covers the first fetch; refreshes swap data in place.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      Promise.all([
        fetchRuns(window, status === "all" ? undefined : status),
        fetchRunStats(window),
        fetchWorkflowSummaries(),
      ])
        .then(([nextRuns, nextStats, workflows]) => {
          if (cancelled) return;
          setRuns(nextRuns);
          setStats(nextStats);
          setNames(new Map(workflows.map((w) => [w.id, w.name])));
          setSelectedId((id) => (id && nextRuns.some((r) => r.id === id) ? id : (nextRuns[0]?.id ?? null)));
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => {
          if (cancelled) return;
          setNow(Date.now());
          setLoading(false);
        });

    void load();
    const timer = autoRefresh ? setInterval(load, POLL_MS) : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [window, status, autoRefresh, reloadKey]);

  const needle = query.trim().toLowerCase();
  const visible = runs.filter(
    (run) =>
      (trigger === "all" || run.trigger.source === trigger) &&
      (!needle ||
        [run.id, names.get(run.workflowId) ?? "", run.error ?? "", run.status].some((f) => f.toLowerCase().includes(needle))),
  );
  const selected = visible.find((r) => r.id === selectedId) ?? visible[0];

  const replay = async () => {
    if (!selected) return;
    setReplaying(true);
    try {
      const run = await replayRun(selected.id);
      setSelectedId(run.id);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplaying(false);
    }
  };

  const exportRuns = () => {
    const blob = new Blob([JSON.stringify(visible, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `reqora-runs-${window}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col w-full pb-16">
      <section className="w-full px-space-lg py-space-md bg-surface-container-low shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-space-sm flex-1">
            {metrics(stats, window).map((m) => (
              <div
                key={m.label}
                className="p-space-sm rounded-lg bg-surface-container flex items-center justify-between group hover:bg-surface-container-high transition-colors shadow-sm"
              >
                <div className="min-w-0">
                  <span className="block font-label-sm text-label-sm uppercase tracking-wider text-outline truncate">
                    {m.label}
                  </span>
                  <div className="flex items-baseline gap-space-xs mt-space-xxs">
                    <span className={`font-display-lg text-headline-lg font-bold ${m.valueClass}`}>{m.value}</span>
                    <span className={`font-label-sm text-label-sm ${m.noteClass}`}>{m.note}</span>
                  </div>
                </div>
                <div className={`w-9 h-9 rounded flex items-center justify-center flex-shrink-0 ${m.iconWrapClass}`}>
                  <Icon name={m.icon} className="text-headline-sm" />
                </div>
              </div>
            ))}
          </div>
          <TimeRangePicker value={window} onChange={setWindow} onExport={exportRuns} />
        </div>
      </section>

      {error && (
        <div className="mx-space-sm mt-space-sm px-space-md py-space-xs rounded-lg bg-error-container/60 text-on-error-container font-body-sm text-body-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-sm p-space-sm items-start">
        <RunsPanel
          runs={visible}
          workflowNames={names}
          now={now}
          loading={loading}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          query={query}
          onQuery={setQuery}
          status={status}
          onStatus={setStatus}
          trigger={trigger}
          onTrigger={setTrigger}
          autoRefresh={autoRefresh}
          onAutoRefresh={setAutoRefresh}
        />
        <RunInspector
          key={selected?.id}
          run={selected}
          workflowName={selected && names.get(selected.workflowId)}
          replaying={replaying}
          onReplay={replay}
          onOpenRun={setSelectedId}
        />
      </div>
    </div>
  );
}
