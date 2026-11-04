"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import type { Telemetry } from "@/lib/telemetry/compute";
import { ApiError, replayRun } from "@/lib/workflows/client";
import type { RunWindow } from "@/lib/workflows/schema";

/** Chart colours, validated for the dark surface (lightness band, chroma, CVD separation, contrast). */
const OK_COLOR = "#0aa5c2";
const FAIL_COLOR = "#e5484d";
const POLL_MS = 10_000;
const WINDOWS: RunWindow[] = ["24h", "7d", "30d"];

const CARD = "p-space-md bg-surface-container-low rounded-xl shadow-md";
const LABEL = "font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider";

async function fetchTelemetry(window: RunWindow, workflowId?: string): Promise<Telemetry> {
  const params = new URLSearchParams({ since: window, ...(workflowId ? { workflowId } : {}) });
  const response = await fetch(`/api/telemetry?${params}`);
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { detail?: string };
    throw new ApiError(response.status, problem.detail ?? response.statusText);
  }
  return (await response.json()) as Telemetry;
}

const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const pctText = (v: number) => `${(Math.round(v * 1000) / 10).toFixed(1)}%`;

function bucketLabel(iso: string, bucketMinutes: number) {
  const d = new Date(iso);
  if (bucketMinutes < 1440) {
    const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return bucketMinutes <= 60 ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Runs per bucket, OK stacked under failed, with a hover tooltip. */
function ThroughputChart({ t }: { t: Telemetry }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 170;
  const pad = { top: 8, right: 4, bottom: 4, left: 30 };
  const max = niceMax(Math.max(...t.buckets.map((b) => b.succeeded + b.failed), 1));
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const slot = plotW / t.buckets.length;
  const barW = Math.max(1, slot - 2);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const point = hover === null ? undefined : t.buckets[hover];
  const ticks = [0, Math.floor((t.buckets.length - 1) / 2), t.buckets.length - 1];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-56"
        preserveAspectRatio="none"
        role="img"
        aria-label="Workflow runs per period, OK and failed"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((((e.clientX - box.left) / box.width) * W - pad.left) / slot);
          setHover(i >= 0 && i < t.buckets.length ? i : null);
        }}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke="#1b2b3f" strokeDasharray="3,3" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={pad.left - 4} y={y(v) + 3} textAnchor="end" className="fill-outline text-[9px] font-mono">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {t.buckets.map((b, i) => {
          const x = pad.left + i * slot + 1;
          const okTop = y(b.succeeded);
          const failTop = y(b.succeeded + b.failed);
          return (
            <g key={b.start} opacity={hover === null || hover === i ? 1 : 0.55}>
              {b.succeeded > 0 && <rect x={x} y={okTop} width={barW} height={y(0) - okTop} rx={1.5} fill={OK_COLOR} />}
              {b.failed > 0 && <rect x={x} y={failTop} width={barW} height={Math.max(0.5, okTop - failTop - (b.succeeded ? 1 : 0))} rx={1.5} fill={FAIL_COLOR} />}
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between font-label-sm text-label-sm text-outline mt-space-xs pl-[5%]">
        {ticks.map((i) => (
          <span key={i}>{i === t.buckets.length - 1 ? "Now" : bucketLabel(t.buckets[i].start, t.bucketMinutes)}</span>
        ))}
      </div>
      {point && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 px-space-xs py-1 rounded bg-surface-container-highest shadow-lg font-label-sm text-label-sm text-on-surface whitespace-nowrap z-10"
          style={{ left: `${((pad.left + (hover! + 0.5) * slot) / W) * 100}%` }}
        >
          <div className="text-outline">{bucketLabel(point.start, t.bucketMinutes)}</div>
          <div>
            {point.succeeded} OK · {point.failed} failed
          </div>
        </div>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-space-lg text-center font-body-sm text-body-sm text-outline">{children}</div>;
}

export function TelemetryDashboard() {
  const [window, setWindow] = useState<RunWindow>("24h");
  const [workflowId, setWorkflowId] = useState<string | undefined>();
  const [data, setData] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [replaying, setReplaying] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== "visible") return;
      fetchTelemetry(window, workflowId)
        .then((next) => {
          if (cancelled) return;
          setData(next);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message));
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [window, workflowId, reloadKey]);

  const replay = async (runId: string) => {
    setReplaying(runId);
    try {
      await replayRun(runId);
      setReloadKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplaying(null);
    }
  };

  const now = data ? Date.parse(data.generatedAt) : 0;
  const t = data;
  const maxCause = Math.max(1, ...(t?.rootCauses.map((c) => c.count) ?? [1]));
  const bottleneck = t?.pipeline && t.pipeline.nodes.length > 1 ? t.pipeline.nodes.reduce((a, b) => (b.sharePct > a.sharePct ? b : a)) : undefined;
  const showBottleneck = bottleneck && bottleneck.sharePct >= 40;

  return (
    <div className="flex flex-col w-full pb-14" data-testid="telemetry">
      <div className="px-space-lg pt-space-lg flex flex-wrap items-center justify-between gap-space-sm">
        <div>
          <h1 className="font-headline-md text-headline-md text-on-surface font-semibold">Telemetry &amp; Metrics</h1>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            From stored workflow runs (manual, replays and webhooks). Load-test runs are reported in each flow&apos;s Load Test panel.
          </p>
        </div>
        <div className="flex items-center gap-space-xs">
          {error && (
            <span className="font-body-sm text-body-sm text-error flex items-center gap-1" role="alert">
              <Icon name="error" className="text-body-md" /> {error}
            </span>
          )}
          <div className="flex rounded-lg bg-surface-container p-0.5" role="radiogroup" aria-label="Time window">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={window === w}
                onClick={() => setWindow(w)}
                className={`px-space-sm py-1 rounded font-label-md text-label-md ${
                  window === w ? "bg-surface-container-highest text-primary font-semibold" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!t ? (
        <div className="px-space-lg pt-space-lg flex items-center gap-space-xs text-outline font-body-md">
          <Icon name="progress_activity" className="animate-spin" /> Loading telemetry…
        </div>
      ) : (
        <>
          {t.sampled && (
            <div className="mx-space-lg mt-space-sm px-space-sm py-space-xs rounded bg-tertiary/10 text-tertiary font-body-sm text-body-sm">
              More runs than can be analysed at once: figures use the newest 20,000 runs in this window.
            </div>
          )}

          {/* KPIs */}
          <div className="px-space-lg pt-space-md grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
            <div className={`${CARD} relative overflow-hidden flex flex-col justify-between`}>
              <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-primary/10 rounded-full blur-xl pointer-events-none" />
              <div className="flex items-center justify-between">
                <span className={LABEL}>Workflow runs</span>
                {t.totals.changePct !== null && (
                  <span
                    className={`flex items-center gap-space-xxs font-label-sm text-label-sm px-space-xs py-space-xxs rounded ${
                      t.totals.changePct >= 0 ? "text-primary bg-primary/10" : "text-tertiary bg-tertiary/10"
                    }`}
                    title={`${t.totals.previousRuns.toLocaleString()} in the previous ${t.window}`}
                  >
                    <Icon name={t.totals.changePct >= 0 ? "trending_up" : "trending_down"} className="text-body-sm" />
                    {t.totals.changePct >= 0 ? "+" : ""}
                    {t.totals.changePct}%
                  </span>
                )}
              </div>
              <div className="mt-space-sm flex items-baseline gap-space-xs">
                <span className="font-display-lg text-display-lg text-on-surface tracking-tight" data-testid="kpi-runs">
                  {t.totals.runs.toLocaleString()}
                </span>
                <span className="font-body-sm text-body-sm text-outline">/ {t.window}</span>
              </div>
              <div className="mt-space-sm flex items-center justify-between text-outline font-label-sm text-label-sm">
                <span>
                  {t.totals.succeeded.toLocaleString()} OK · {t.totals.failed.toLocaleString()} failed
                </span>
                <span className="text-on-surface">{t.totals.successRate === null ? "—" : `${pctText(t.totals.successRate)} success`}</span>
              </div>
              <div className="w-full bg-surface-container-highest h-1 rounded-full mt-space-xs overflow-hidden">
                <div className="bg-primary h-full rounded-full" style={{ width: `${(t.totals.successRate ?? 0) * 100}%` }} />
              </div>
            </div>

            <div className={`${CARD} flex flex-col justify-between`}>
              <div className="flex items-center justify-between">
                <span className={LABEL}>Failure spikes</span>
                {t.spikes.count === 0 ? (
                  <span className="flex items-center gap-space-xxs font-label-sm text-label-sm text-primary px-space-xs py-space-xxs bg-primary/10 rounded">
                    <Icon name="check_circle" className="text-body-sm" /> Nominal
                  </span>
                ) : (
                  <span className="flex items-center gap-space-xxs font-label-sm text-label-sm text-error px-space-xs py-space-xxs bg-error/10 rounded">
                    <Icon name="warning" className="text-body-sm" /> Spikes
                  </span>
                )}
              </div>
              <div className="mt-space-sm flex items-center gap-space-sm">
                <div
                  className={`w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center ${t.spikes.count ? "text-error" : "text-primary"}`}
                >
                  <Icon name={t.spikes.count ? "crisis_alert" : "verified_user"} className="text-headline-md" />
                </div>
                <div>
                  <div className="font-display-lg text-display-lg text-on-surface leading-none">{t.spikes.count}</div>
                  <div className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
                    {t.bucketMinutes >= 1440 ? "days" : t.bucketMinutes > 60 ? "6-hour periods" : "hours"} with ≥3 failures and ≥20% failing
                  </div>
                </div>
              </div>
              <div className="mt-space-sm font-label-sm text-label-sm text-on-surface-variant bg-surface-container p-space-xs rounded">
                {t.spikes.last
                  ? `Last: ${bucketLabel(t.spikes.last.start, t.bucketMinutes)} — ${t.spikes.last.failed} of ${t.spikes.last.runs} runs failed`
                  : `No spikes in the last ${t.window}`}
              </div>
            </div>

            <div className={`${CARD} flex flex-col justify-between`}>
              <div className="flex items-center justify-between">
                <span className={LABEL}>p95 run duration</span>
                <Icon name="speed" className="text-tertiary text-body-md" />
              </div>
              <div className="mt-space-xs">
                <div className="font-display-lg text-display-lg text-on-surface">{t.latency ? ms(t.latency.p95) : "—"}</div>
                <div className="font-body-sm text-body-sm text-outline mt-space-xxs">
                  {t.latency ? `Avg ${ms(t.latency.avg)} · p50 ${ms(t.latency.p50)} · p99 ${ms(t.latency.p99)}` : "No runs yet"}
                </div>
              </div>
              <div className="mt-space-sm font-label-sm text-label-sm text-outline">
                {t.peak ? `Busiest: ${t.peak.runs.toLocaleString()} runs at ${bucketLabel(t.peak.start, t.bucketMinutes)}` : " "}
              </div>
            </div>

            <div className={`${CARD} flex flex-col`}>
              <div className="flex items-center justify-between mb-space-xs">
                <span className={LABEL}>Upstream APIs</span>
                <span className="font-label-sm text-label-sm text-outline">error rate</span>
              </div>
              {t.upstreams.length === 0 && <span className="font-body-sm text-body-sm text-outline">No HTTP calls in this window.</span>}
              <div className="space-y-space-xs">
                {t.upstreams.slice(0, 3).map((u) => {
                  const rate = u.failed / u.calls;
                  return (
                    <div key={u.host} title={`${u.calls} calls · avg ${ms(u.avgMs)} · p95 ${ms(u.p95Ms)}`}>
                      <div className="flex justify-between font-label-sm text-label-sm mb-space-xxs gap-space-xs">
                        <span className="text-on-surface truncate">{u.host}</span>
                        <span className={`${rate > 0.05 ? "text-error" : "text-on-surface-variant"} font-semibold shrink-0`}>
                          {pctText(rate)} · {u.calls.toLocaleString()}
                        </span>
                      </div>
                      <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(rate * 100, rate ? 2 : 0)}%`, background: FAIL_COLOR }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Throughput + root causes */}
          <div className="px-space-lg pt-space-md grid grid-cols-1 lg:grid-cols-12 gap-space-md">
            <div className={`lg:col-span-8 ${CARD}`}>
              <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-sm">
                <div>
                  <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Execution Throughput &amp; Errors</span>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
                    Runs per {t.bucketMinutes >= 1440 ? "day" : t.bucketMinutes > 60 ? "6 hours" : "hour"}, last {t.window}
                  </p>
                </div>
                <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
                  <span className="flex items-center gap-space-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: OK_COLOR }} /> Succeeded
                  </span>
                  <span className="flex items-center gap-space-xs">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAIL_COLOR }} /> Failed
                  </span>
                  <Link href="/executions" className="px-space-xs py-space-xxs bg-surface-container-highest text-on-surface rounded hover:bg-surface-bright">
                    Execution History
                  </Link>
                </div>
              </div>
              {t.totals.runs ? <ThroughputChart t={t} /> : <Empty>No runs in the last {t.window}. Run a workflow to see data here.</Empty>}
            </div>

            <div className={`lg:col-span-4 ${CARD} flex flex-col`}>
              <div className="flex items-center justify-between">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Error Root Cause</span>
                <span className="font-label-sm text-label-sm text-outline">{t.totals.failed.toLocaleString()} failed runs</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs mb-space-sm">Grouped by the failing step&apos;s error</p>
              {t.rootCauses.length === 0 ? (
                <Empty>No failures in this window.</Empty>
              ) : (
                <div className="space-y-space-xs" data-testid="root-causes">
                  {t.rootCauses.slice(0, 6).map((c) => (
                    <div key={c.label}>
                      <div className="flex justify-between font-label-sm text-label-sm mb-space-xxs">
                        <span className="text-on-surface">{c.label}</span>
                        <span className="text-on-surface-variant font-semibold">
                          {c.count.toLocaleString()} ({Math.round((c.count / t.totals.failed) * 100)}%)
                        </span>
                      </div>
                      <div className="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${(c.count / maxCause) * 100}%`, background: FAIL_COLOR }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Per-node latency */}
          <div className="px-space-lg pt-space-md">
            <div className={CARD}>
              <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-md">
                <div>
                  <div className="flex items-center gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Per-Node Latency</span>
                    {showBottleneck && (
                      <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-error/15 text-error uppercase font-bold">
                        Bottleneck: {bottleneck!.name}
                      </span>
                    )}
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
                    {t.pipeline
                      ? `Share of each run spent in each node (${t.pipeline.runs.toLocaleString()} runs, avg ${ms(t.pipeline.avgRunMs)})`
                      : "No runs yet"}
                  </p>
                </div>
                {t.workflows.length > 0 && (
                  <select
                    aria-label="Workflow"
                    className="px-space-sm py-1 rounded bg-surface-container-highest text-on-surface font-body-sm text-body-sm focus:outline-none"
                    value={t.pipeline?.workflowId ?? ""}
                    onChange={(e) => setWorkflowId(e.target.value)}
                  >
                    {t.workflows.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.runs.toLocaleString()} runs)
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {t.pipeline && (
                <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-5 gap-space-sm" data-testid="pipeline">
                  {t.pipeline.nodes.map((node, i) => {
                    const hot = showBottleneck && node.nodeId === bottleneck!.nodeId;
                    return (
                      <div
                        key={node.nodeId}
                        className={`p-space-sm rounded-lg relative overflow-hidden flex flex-col justify-between ${hot ? "bg-surface-container-high shadow-lg" : "bg-surface-container"}`}
                      >
                        {hot && <div className="absolute inset-x-0 top-0 h-1" style={{ background: FAIL_COLOR }} />}
                        <div className="flex items-center justify-between mb-space-xs">
                          <span className={`font-label-sm text-label-sm uppercase font-semibold ${hot ? "text-error" : "text-outline"}`}>
                            Node {String(i + 1).padStart(2, "0")} · {node.type}
                          </span>
                          <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-highest px-space-xxs rounded">
                            {node.sharePct}% of run
                          </span>
                        </div>
                        <div className="font-headline-sm text-headline-sm text-on-surface font-medium truncate" title={node.nodeId}>
                          {node.name}
                        </div>
                        <div className="mt-space-sm flex items-baseline justify-between">
                          <span className={`font-display-lg text-display-lg leading-none ${hot ? "text-error font-bold" : "text-on-surface"}`}>
                            {ms(node.avgMs)}
                          </span>
                          <span className="font-label-sm text-label-sm text-outline">p95 {ms(node.p95Ms)}</span>
                        </div>
                        <div className="w-full bg-surface-container-highest h-1.5 rounded-full mt-space-sm overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.max(node.sharePct, 1)}%`, background: hot ? FAIL_COLOR : OK_COLOR }} />
                        </div>
                        <div className="mt-space-xs font-label-sm text-label-sm text-outline">
                          {node.calls.toLocaleString()} calls{node.failed ? <span className="text-error"> · {node.failed} failed</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Recent runs */}
          <div className="px-space-lg pt-space-md mb-space-md">
            <div className={CARD}>
              <div className="flex items-center justify-between mb-space-sm">
                <div className="flex items-center gap-space-xs">
                  <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                  <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Recent Runs</span>
                  <span className="font-label-sm text-label-sm text-outline">updates every 10s</span>
                </div>
                <Link href="/executions" className="font-label-md text-label-md text-primary hover:underline">
                  All {t.totals.runs.toLocaleString()} runs →
                </Link>
              </div>
              {t.recent.length === 0 ? (
                <Empty>No runs yet.</Empty>
              ) : (
                <table className="w-full font-body-sm text-body-sm" data-testid="recent-runs">
                  <thead>
                    <tr className="text-left font-label-sm text-label-sm text-outline">
                      <th className="font-normal py-1">Run</th>
                      <th className="font-normal">Workflow</th>
                      <th className="font-normal">Duration</th>
                      <th className="font-normal">Status</th>
                      <th className="font-normal">Detail</th>
                      <th className="font-normal text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.recent.map((r) => (
                      <tr key={r.id} className="border-t border-outline-variant/20">
                        <td className="py-space-xs">
                          <div className="flex items-center gap-space-xs">
                            <Icon name={r.status === "succeeded" ? "check_circle" : "error"} className={r.status === "succeeded" ? "text-primary" : "text-error"} />
                            <div className="flex flex-col">
                              <span className="font-mono text-label-sm text-on-surface">{r.id}</span>
                              <span className="font-label-sm text-label-sm text-outline">
                                {ago(r.startedAt, now)} · {r.source} · {r.environment}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="text-on-surface">{r.workflowName}</td>
                        <td className="font-mono text-on-surface">{ms(r.durationMs)}</td>
                        <td>
                          <span
                            className={`px-space-xs py-0.5 rounded font-label-sm text-label-sm font-semibold ${
                              r.status === "succeeded" ? "bg-primary/20 text-primary" : "bg-error/20 text-error"
                            }`}
                          >
                            {r.status === "succeeded" ? "OK" : r.failedStep?.httpStatus ? `HTTP ${r.failedStep.httpStatus}` : "FAILED"}
                          </span>
                        </td>
                        <td className="max-w-md">
                          {r.failedStep ? (
                            <span className="text-on-surface-variant">
                              <span className="text-error font-semibold">{r.failedStep.name}:</span> {r.failedStep.error}
                            </span>
                          ) : (
                            <span className="text-outline">
                              {r.executed} step{r.executed === 1 ? "" : "s"} succeeded
                            </span>
                          )}
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => replay(r.id)}
                            disabled={replaying !== null}
                            title="Run the workflow again with this run's payload"
                            className="inline-flex items-center gap-1 px-space-xs py-0.5 rounded bg-surface-container-highest text-on-surface font-label-sm text-label-sm hover:bg-surface-bright disabled:opacity-50"
                          >
                            <Icon name={replaying === r.id ? "progress_activity" : "replay"} className={`text-body-sm ${replaying === r.id ? "animate-spin" : ""}`} />
                            Replay
                          </button>{" "}
                          <Link
                            href={`/executions?run=${r.id}`}
                            className="inline-flex items-center gap-1 px-space-xs py-0.5 rounded text-primary font-label-sm text-label-sm hover:underline"
                          >
                            Inspect
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
