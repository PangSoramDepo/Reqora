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

/** A smooth line through the points that never overshoots them (cubic segments with level control points). */
function smoothPath(points: { x: number; y: number }[]) {
  return points
    .map((p, i) => {
      if (i === 0) return `M ${p.x},${p.y}`;
      const prev = points[i - 1];
      const mid = (prev.x + p.x) / 2;
      return `C ${mid},${prev.y} ${mid},${p.y} ${p.x},${p.y}`;
    })
    .join(" ");
}

/** The element's width in CSS pixels, kept up to date (so SVG text and markers aren't stretched). */
function useWidth<T extends HTMLElement>(fallback: number) {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width] as const;
}

const compact = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const PER_BUCKET: Record<number, string> = { 60: "hour", 360: "6h", 1440: "day" };

/**
 * Successful and failed runs over the window as smooth areas (the design's "throughput & error spectrum"), with
 * the worst error point marked, a hover crosshair and the window's success rate, error count and peak.
 */
function ThroughputChart({ t }: { t: Telemetry }) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth<HTMLDivElement>(600);
  const H = 190;
  const pad = { top: 18, right: 6, bottom: 6, left: 26 };
  const n = t.buckets.length;
  const max = niceMax(Math.max(...t.buckets.map((b) => Math.max(b.succeeded, b.failed)), 1));
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const ok = t.buckets.map((b, i) => ({ x: x(i), y: y(b.succeeded) }));
  const bad = t.buckets.map((b, i) => ({ x: x(i), y: y(b.failed) }));
  const area = (line: string) => `${line} L ${x(n - 1)},${y(0)} L ${x(0)},${y(0)} Z`;

  // Annotate the worst error point: the latest spike, otherwise the bucket with the most failures.
  const spikeIndex = t.spikes.last ? t.buckets.findIndex((b) => b.start === t.spikes.last!.start) : -1;
  const worst = t.buckets.reduce((best, b, i) => (b.failed > (t.buckets[best]?.failed ?? 0) ? i : best), -1);
  const marked = spikeIndex >= 0 ? spikeIndex : worst;
  const mark = marked >= 0 && t.buckets[marked].failed > 0 ? t.buckets[marked] : undefined;
  const markRate = mark ? mark.failed / (mark.succeeded + mark.failed) : 0;
  const markLeft = marked >= 0 && x(marked) > W * 0.7;

  const point = hover === null ? undefined : t.buckets[hover];
  const tickCount = Math.min(7, n);
  const ticks = Array.from({ length: tickCount }, (_, k) => Math.round((k / Math.max(1, tickCount - 1)) * (n - 1)));

  return (
    <div className="flex flex-col flex-1">
      <div ref={ref} className="relative w-full pt-space-xs">
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          className="block overflow-visible"
          role="img"
          aria-label={`Successful and failed runs per ${PER_BUCKET[t.bucketMinutes] ?? "period"}, last ${t.window}`}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect();
            const px = e.clientX - box.left;
            const i = Math.round(((px - pad.left) / Math.max(1, plotW)) * (n - 1));
            setHover(i >= 0 && i < n ? i : null);
          }}
        >
          <defs>
            <linearGradient id="okAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="errorAreaGrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-error)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--color-error)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {[max / 4, max / 2, (max * 3) / 4, max].map((v) => (
            <g key={v}>
              <line x1={pad.left} x2={W - pad.right} y1={y(v)} y2={y(v)} stroke="#1b2b3f" strokeDasharray="3,3" strokeWidth={1} />
              <text x={pad.left - 6} y={y(v) + 3} textAnchor="end" className="fill-outline font-mono" fontSize={9}>
                {Number.isInteger(v) ? v : v.toFixed(1)}
              </text>
            </g>
          ))}
          <line x1={pad.left} x2={W - pad.right} y1={y(0)} y2={y(0)} stroke="#1b2b3f" strokeWidth={1} />

          <path d={area(smoothPath(ok))} fill="url(#okAreaGrad)" />
          <path d={smoothPath(ok)} fill="none" stroke="var(--color-primary)" strokeLinecap="round" strokeWidth={2.5} />
          <path d={area(smoothPath(bad))} fill="url(#errorAreaGrad)" />
          <path d={smoothPath(bad)} fill="none" stroke="var(--color-error)" strokeLinecap="round" strokeWidth={1.8} />

          {mark && (
            <g data-testid="error-spike">
              <circle className="fill-error animate-ping origin-center [transform-box:fill-box]" cx={x(marked)} cy={y(mark.failed)} r={3.5} />
              <circle className="fill-error" cx={x(marked)} cy={y(mark.failed)} r={3.5} />
              <text
                x={x(marked) + (markLeft ? -8 : 8)}
                y={y(mark.failed) - 8}
                textAnchor={markLeft ? "end" : "start"}
                fill="var(--color-error)"
                fontFamily="JetBrains Mono, monospace"
                fontSize={9}
              >
                {mark.failed} failed ({pctText(markRate)}) · {bucketLabel(mark.start, t.bucketMinutes)}
              </text>
            </g>
          )}

          {point && (
            <g pointerEvents="none">
              <line x1={x(hover!)} x2={x(hover!)} y1={pad.top} y2={y(0)} stroke="var(--color-outline)" strokeOpacity={0.5} strokeWidth={1} />
              <circle cx={x(hover!)} cy={y(point.succeeded)} r={4} fill="var(--color-primary)" stroke="#0b1c30" strokeWidth={2} />
              <circle cx={x(hover!)} cy={y(point.failed)} r={4} fill="var(--color-error)" stroke="#0b1c30" strokeWidth={2} />
            </g>
          )}
        </svg>
        {point && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 px-space-xs py-1 rounded bg-surface-container-highest shadow-lg font-label-sm text-label-sm text-on-surface whitespace-nowrap z-10"
            style={{ left: Math.min(Math.max(x(hover!), 95), W - 95) }}
          >
            <div className="text-outline">{bucketLabel(point.start, t.bucketMinutes)}</div>
            <div className="flex items-center gap-space-xs">
              <span className="w-2 h-2 rounded bg-primary" /> {point.succeeded} successful
              <span className="w-2 h-2 rounded bg-error ml-space-xs" /> {point.failed} failed
            </div>
          </div>
        )}
        <div className="flex justify-between font-label-sm text-label-sm text-outline mt-space-xs" style={{ paddingLeft: pad.left }}>
          {ticks.map((i, k) => (
            <span key={k}>{i === n - 1 ? "Now (Live)" : bucketLabel(t.buckets[i].start, t.bucketMinutes)}</span>
          ))}
        </div>
      </div>

      {/* Quick sub-metric footnotes */}
      <div className="grid grid-cols-3 gap-space-sm mt-space-sm bg-surface-container-lowest/60 rounded p-space-xs">
        <div className="flex flex-col">
          <span className="font-label-sm text-label-sm text-outline">SUCCESS RATE</span>
          <span className="font-headline-sm text-headline-sm text-primary font-bold">{t.totals.successRate === null ? "—" : pctText(t.totals.successRate)}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-label-sm text-label-sm text-outline">ERROR COUNT</span>
          <span className="font-headline-sm text-headline-sm text-error font-bold">{t.totals.failed.toLocaleString()}</span>
        </div>
        <div className="flex flex-col">
          <span className="font-label-sm text-label-sm text-outline">PEAK RUNS / {(PER_BUCKET[t.bucketMinutes] ?? "period").toUpperCase()}</span>
          <span className="font-headline-sm text-headline-sm text-on-surface font-bold" title={t.peak ? bucketLabel(t.peak.start, t.bucketMinutes) : undefined}>
            {t.peak ? `${t.peak.runs.toLocaleString()} runs` : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The design's root-cause slices: three tones, then the rest grouped as "Other". */
const CAUSE_TONES = [
  { stroke: "text-error", dot: "bg-error", text: "text-error" },
  { stroke: "text-tertiary", dot: "bg-tertiary", text: "text-tertiary" },
  { stroke: "text-secondary", dot: "bg-secondary", text: "text-secondary" },
  { stroke: "text-outline", dot: "bg-outline", text: "text-on-surface-variant" },
];

/** Failures by cause as a donut with the total in the middle, and a legend with share and count. */
function RootCauseDonut({ t }: { t: Telemetry }) {
  const [active, setActive] = useState<number | null>(null);
  const total = t.rootCauses.reduce((sum, c) => sum + c.count, 0);
  const top = t.rootCauses.slice(0, 3);
  const rest = t.rootCauses.slice(3).reduce((sum, c) => sum + c.count, 0);
  const slices = [...top, ...(rest ? [{ label: `Other (${t.rootCauses.length - 3} causes)`, count: rest }] : [])];
  const GAP = slices.length > 1 ? 0.8 : 0;
  let offset = 0;

  return (
    <>
      <div className="my-space-md flex flex-col items-center">
        <div className="relative w-36 h-36 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 42 42" role="img" aria-label="Failures by root cause">
            <circle className="text-surface-container-highest stroke-current" cx="21" cy="21" fill="none" r="15.91549430918954" strokeWidth="4.5" />
            {slices.map((s, i) => {
              const share = (s.count / total) * 100;
              const dash = Math.max(0.5, share - GAP);
              const el = (
                <circle
                  key={s.label}
                  className={`${CAUSE_TONES[i].stroke} stroke-current transition-opacity cursor-pointer`}
                  cx="21"
                  cy="21"
                  fill="none"
                  r="15.91549430918954"
                  strokeDasharray={`${dash} ${100 - dash}`}
                  strokeDashoffset={-offset}
                  strokeWidth={active === i ? 6 : 5}
                  opacity={active === null || active === i ? 1 : 0.35}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                >
                  <title>{`${s.label}: ${s.count.toLocaleString()} (${Math.round(share)}%)`}</title>
                </circle>
              );
              offset += share;
              return el;
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="font-headline-md text-headline-md text-on-surface font-bold leading-none">
              {active === null ? compact(total) : compact(slices[active].count)}
            </span>
            <span className="font-label-sm text-label-sm text-outline mt-space-xxs">{active === null ? "FAILS" : `${Math.round((slices[active].count / total) * 100)}%`}</span>
          </div>
        </div>
      </div>
      <div className="space-y-space-xs" data-testid="root-causes">
        {slices.map((s, i) => (
          <div
            key={s.label}
            className={`flex items-center justify-between gap-space-xs p-space-xs rounded transition-colors ${active === i ? "bg-surface-container-highest" : "bg-surface-container-high/60"}`}
            onPointerEnter={() => setActive(i)}
            onPointerLeave={() => setActive(null)}
          >
            <div className="flex items-center gap-space-xs min-w-0">
              <span className={`w-2 h-2 shrink-0 rounded ${CAUSE_TONES[i].dot}`} />
              <span className="font-label-sm text-label-sm text-on-surface truncate" title={s.label}>
                {s.label}
              </span>
            </div>
            <span className={`font-body-sm text-body-sm font-semibold whitespace-nowrap ${CAUSE_TONES[i].text}`}>
              {Math.round((s.count / total) * 100)}% ({s.count.toLocaleString()})
            </span>
          </div>
        ))}
      </div>
    </>
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
            <div className="lg:col-span-8 bg-surface-container-low rounded-xl p-space-md shadow-md flex flex-col justify-between">
              <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-md">
                <div>
                  <div className="flex items-center gap-space-xs">
                    <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Execution Throughput &amp; Error Spectrum</span>
                    <span className="font-label-sm text-label-sm text-outline px-space-xs py-space-xxs rounded bg-surface-container-high">Live {t.window}</span>
                  </div>
                  <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
                    Successful runs vs failed runs per {PER_BUCKET[t.bucketMinutes] ?? "period"} across your workflows
                  </p>
                </div>
                <div className="flex items-center gap-space-sm">
                  <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                    <span className="w-2.5 h-2.5 rounded bg-primary" />
                    <span>Successful</span>
                  </div>
                  <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                    <span className="w-2.5 h-2.5 rounded bg-error" />
                    <span>Errors (failed runs)</span>
                  </div>
                  <Link
                    href="/executions"
                    className="px-space-xs py-space-xxs bg-surface-container-highest text-on-surface rounded hover:bg-surface-bright transition-colors font-label-sm text-label-sm"
                    title="Open Execution History"
                  >
                    Inspect Raw
                  </Link>
                </div>
              </div>
              {t.totals.runs ? <ThroughputChart t={t} /> : <Empty>No runs in the last {t.window}. Run a workflow to see data here.</Empty>}
            </div>

            <div className="lg:col-span-4 bg-surface-container-low rounded-xl p-space-md shadow-md flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Error Root Cause</span>
                  <Icon name="pie_chart" className="text-outline text-body-md" />
                </div>
                <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">Failures by the failing step&apos;s error</p>
              </div>
              {t.rootCauses.length === 0 ? (
                <div className="my-space-md flex flex-col items-center gap-space-sm">
                  <div className="relative w-36 h-36 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90" viewBox="0 0 42 42" aria-hidden="true">
                      <circle className="text-surface-container-highest stroke-current" cx="21" cy="21" fill="none" r="15.91549430918954" strokeWidth="4.5" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-headline-md text-headline-md text-on-surface font-bold leading-none">0</span>
                      <span className="font-label-sm text-label-sm text-outline mt-space-xxs">FAILS</span>
                    </div>
                  </div>
                  <span className="font-body-sm text-body-sm text-outline">No failures in the last {t.window}.</span>
                </div>
              ) : (
                <RootCauseDonut t={t} />
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
