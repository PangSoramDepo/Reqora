"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import { fetchLoadTest, fetchLoadTests, startLoadTest, stopLoadTest, type LoadTestInput } from "@/lib/loadtest/client";
import { LOAD_LIMITS, type LatencyStats, type LoadTest, type LoadTestSummary } from "@/lib/loadtest/schema";
import type { Environment } from "@/lib/workflows/schema";

/** Chart colours, validated for the dark chart surface (lightness band, chroma, CVD, contrast). */
const OK_COLOR = "#0aa5c2";
const FAIL_COLOR = "#e5484d";
const POLL_MS = 1000;

const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const INPUT =
  "w-full px-space-xs py-1 rounded bg-surface-container-lowest font-mono text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40";
const CARD = "rounded-lg bg-surface-container-lowest/70 p-space-sm";

type Props = {
  workflowId: string;
  workflowName: string;
  environment: Environment;
  defaultPayload: unknown;
  /** Saves pending canvas edits so the test runs what is on screen. */
  beforeStart: () => Promise<void>;
  onClose: () => void;
};

type Form = {
  virtualUsers: string;
  mode: "iterations" | "duration";
  iterations: string;
  durationSec: string;
  rampUpSec: string;
  thinkTimeMs: string;
  maxErrorRatePct: string;
  p95Ms: string;
  payload: string;
};

const ms = (v: number) => (v >= 10_000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
const duration = (v: number) => {
  const s = Math.floor(v / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const optionalNumber = (text: string) => (text.trim() === "" ? undefined : Number(text));

function toInput(form: Form, environment: Environment): { input?: LoadTestInput; error?: string } {
  let body: unknown;
  if (form.payload.trim()) {
    try {
      body = JSON.parse(form.payload);
    } catch (e) {
      return { error: `Payload is not valid JSON: ${(e as Error).message}` };
    }
  }
  const input: LoadTestInput = {
    environment,
    virtualUsers: Number(form.virtualUsers),
    mode: form.mode,
    ...(form.mode === "iterations" ? { iterations: Number(form.iterations) } : { durationSec: Number(form.durationSec) }),
    rampUpSec: Number(form.rampUpSec || 0),
    thinkTimeMs: Number(form.thinkTimeMs || 0),
    trigger: body === undefined ? {} : { body },
    thresholds: {
      ...(optionalNumber(form.maxErrorRatePct) === undefined ? {} : { maxErrorRatePct: optionalNumber(form.maxErrorRatePct) }),
      ...(optionalNumber(form.p95Ms) === undefined ? {} : { p95Ms: optionalNumber(form.p95Ms) }),
    },
  };
  return { input };
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="font-label-sm text-label-sm text-outline normal-case tracking-normal">{hint}</span>}
    </label>
  );
}

function StatusBadge({ test }: { test: Pick<LoadTest, "status" | "verdict"> }) {
  const base = "inline-flex items-center gap-1 px-space-xs py-0.5 rounded font-label-sm text-label-sm font-semibold";
  if (test.status === "running") {
    return (
      <span className={`${base} bg-primary/15 text-primary`}>
        <Icon name="progress_activity" className="animate-spin text-[12px]" /> RUNNING
      </span>
    );
  }
  if (test.verdict) {
    return test.verdict.passed ? (
      <span className={`${base} bg-primary/15 text-primary`}>
        <Icon name="check_circle" className="text-[12px]" /> PASSED
      </span>
    ) : (
      <span className={`${base} bg-error-container/60 text-on-error-container`}>
        <Icon name="cancel" className="text-[12px]" /> FAILED
      </span>
    );
  }
  const label = { completed: "COMPLETED", stopped: "STOPPED", interrupted: "INTERRUPTED" }[test.status];
  return <span className={`${base} bg-surface-container-highest text-on-surface-variant`}>{label}</span>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={`${CARD} flex flex-col gap-0.5 min-w-0`}>
      <span className={LABEL}>{label}</span>
      <span className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">{value}</span>
      {sub && <span className="font-label-sm text-label-sm text-outline truncate">{sub}</span>}
    </div>
  );
}

const W = 520;
const H = 110;
const PAD = { top: 8, right: 8, bottom: 18, left: 36 };

/** Nice round axis maximum. */
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v)!;
}

/** Completed iterations per second, stacked OK / failed, with a hover tooltip. */
function ThroughputChart({ timeline }: { timeline: LoadTest["timeline"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...timeline.map((t) => t.succeeded + t.failed), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(timeline.length, 1);
  const barW = Math.max(1, slot - (slot > 4 ? 2 : 0));
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const point = hover === null ? undefined : timeline[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Iterations completed per second"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - box.left) / box.width) * W - PAD.left;
          const i = Math.floor(x / slot);
          setHover(i >= 0 && i < timeline.length ? i : null);
        }}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-outline-variant/40" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" className="fill-outline text-[9px] font-mono">
              {Number.isInteger(v) ? v : v.toFixed(1)}
            </text>
          </g>
        ))}
        {timeline.map((t, i) => {
          const x = PAD.left + i * slot;
          const okTop = y(t.succeeded);
          const failTop = y(t.succeeded + t.failed);
          const gap = t.succeeded > 0 && t.failed > 0 ? 1 : 0;
          return (
            <g key={t.second} opacity={hover === null || hover === i ? 1 : 0.55}>
              {t.succeeded > 0 && <rect x={x} y={okTop} width={barW} height={y(0) - okTop} rx={Math.min(2, barW / 2)} fill={OK_COLOR} />}
              {t.failed > 0 && (
                <rect x={x} y={failTop} width={barW} height={Math.max(0, okTop - failTop - gap)} rx={Math.min(2, barW / 2)} fill={FAIL_COLOR} />
              )}
            </g>
          );
        })}
        <text x={PAD.left} y={H - 4} className="fill-outline text-[9px] font-mono">
          0s
        </text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fill-outline text-[9px] font-mono">
          {timeline.length}s
        </text>
      </svg>
      {point && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 px-space-xs py-1 rounded bg-surface-container-highest shadow-lg font-label-sm text-label-sm text-on-surface whitespace-nowrap"
          style={{ left: `${((PAD.left + (hover! + 0.5) * slot) / W) * 100}%` }}
        >
          <div className="text-outline">Second {point.second + 1}</div>
          <div>{point.succeeded} OK · {point.failed} failed</div>
          <div className="text-outline">{point.activeVirtualUsers} virtual users</div>
        </div>
      )}
    </div>
  );
}

/** p95 run duration per second (single series), with a crosshair tooltip. */
function LatencyChart({ timeline }: { timeline: LoadTest["timeline"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = timeline.map((t) => t.p95Ms);
  const max = niceMax(Math.max(...values.map((v) => v ?? 0), 1));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (timeline.length <= 1 ? plotW / 2 : (i / (timeline.length - 1)) * plotW);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  // Gaps (seconds with no finished run) break the line.
  const path = values
    .map((v, i) => (v === null ? null : `${i === 0 || values[i - 1] === null ? "M" : "L"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`))
    .filter(Boolean)
    .join(" ");
  const point = hover === null ? undefined : timeline[hover];

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="p95 flow duration per second"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          const i = timeline.length <= 1 ? 0 : Math.round(((px - PAD.left) / plotW) * (timeline.length - 1));
          setHover(i >= 0 && i < timeline.length ? i : null);
        }}
      >
        {[0, max / 2, max].map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-outline-variant/40" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v) + 3} textAnchor="end" className="fill-outline text-[9px] font-mono">
              {ms(v)}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke={OK_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {point && (
          <>
            <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={y(0)} stroke="currentColor" className="text-outline" strokeWidth={1} />
            {point.p95Ms !== null && <circle cx={x(hover!)} cy={y(point.p95Ms)} r={4} fill={OK_COLOR} stroke="#0b1c30" strokeWidth={2} />}
          </>
        )}
        <text x={PAD.left} y={H - 4} className="fill-outline text-[9px] font-mono">
          0s
        </text>
        <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fill-outline text-[9px] font-mono">
          {timeline.length}s
        </text>
      </svg>
      {point && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 px-space-xs py-1 rounded bg-surface-container-highest shadow-lg font-label-sm text-label-sm text-on-surface whitespace-nowrap"
          style={{ left: `${(x(hover!) / W) * 100}%` }}
        >
          <div className="text-outline">Second {point.second + 1}</div>
          <div>p95 {point.p95Ms === null ? "—" : ms(point.p95Ms)}</div>
        </div>
      )}
    </div>
  );
}

const latencyCells = (l: LatencyStats | null) => (l ? [ms(l.avg), ms(l.p95), ms(l.max)] : ["—", "—", "—"]);

function Report({ test, onStop, stopping }: { test: LoadTest; onStop: () => void; stopping: boolean }) {
  const { config } = test;
  const running = test.status === "running";
  const progress =
    config.mode === "iterations"
      ? Math.min(1, test.iterations.completed / config.iterations)
      : Math.min(1, test.elapsedMs / (config.durationSec * 1000));

  return (
    <div className="flex flex-col gap-space-sm" data-testid="load-report">
      <div className="flex items-center gap-space-xs flex-wrap">
        <StatusBadge test={test} />
        <span className="font-body-sm text-body-sm text-on-surface-variant">
          {config.virtualUsers} virtual users ·{" "}
          {config.mode === "iterations" ? `${config.iterations} iterations` : `${config.durationSec}s`} ·{" "}
          {ENVIRONMENT_LABELS[test.environment].label}
        </span>
        {running && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="ml-auto flex items-center gap-1 px-space-sm py-1 rounded bg-error-container/70 text-on-error-container font-label-md text-label-md font-semibold disabled:opacity-60"
          >
            <Icon name={stopping ? "progress_activity" : "stop"} className={`text-body-sm ${stopping ? "animate-spin" : ""}`} /> Stop
          </button>
        )}
      </div>

      {test.verdict && !test.verdict.passed && (
        <div className="rounded bg-error-container/40 text-on-error-container px-space-sm py-space-xs font-body-sm text-body-sm" role="alert">
          Thresholds not met: {test.verdict.reasons.join("; ")}.
        </div>
      )}

      <div className="flex flex-col gap-1">
        <div className="h-1.5 rounded-full bg-surface-container-highest overflow-hidden">
          <div className={`h-full bg-primary ${running ? "transition-[width] duration-700" : ""}`} style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="flex justify-between font-label-sm text-label-sm text-outline">
          <span>
            {test.iterations.completed.toLocaleString()}
            {config.mode === "iterations" && ` / ${config.iterations.toLocaleString()}`} iterations
          </span>
          <span>
            {duration(test.elapsedMs)}
            {config.mode === "duration" && ` / ${duration(config.durationSec * 1000)}`}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-space-xs">
        <Stat label="Throughput" value={`${test.throughput} it/s`} sub={`${test.activeVirtualUsers} / ${config.virtualUsers} users active`} />
        <Stat
          label="Error rate"
          value={`${test.errorRatePct}%`}
          sub={`${test.iterations.failed.toLocaleString()} failed`}
        />
        <Stat label="p95" value={test.latency ? ms(test.latency.p95) : "—"} sub={test.latency ? `p50 ${ms(test.latency.p50)} · p99 ${ms(test.latency.p99)}` : undefined} />
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between mb-1">
          <span className={LABEL}>Iterations per second</span>
          <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-on-surface-variant">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: OK_COLOR }} /> OK
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAIL_COLOR }} /> Failed
            </span>
          </div>
        </div>
        {test.timeline.length ? <ThroughputChart timeline={test.timeline} /> : <Empty />}
      </div>

      <div className={CARD}>
        <span className={`${LABEL} block mb-1`}>p95 flow duration per second</span>
        {test.timeline.length ? <LatencyChart timeline={test.timeline} /> : <Empty />}
      </div>

      <div className={CARD}>
        <span className={`${LABEL} block mb-1`}>Per node</span>
        <table className="w-full font-body-sm text-body-sm">
          <thead>
            <tr className="text-outline text-left font-label-sm text-label-sm">
              <th className="font-normal py-0.5">Node</th>
              <th className="font-normal text-right">Calls</th>
              <th className="font-normal text-right">Failed</th>
              <th className="font-normal text-right">Avg</th>
              <th className="font-normal text-right">p95</th>
              <th className="font-normal text-right">Max</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {test.nodes.map((n) => (
              <tr key={n.nodeId} className="text-on-surface">
                <td className="py-0.5 font-body-sm truncate max-w-36" title={n.nodeId}>
                  {n.name}
                </td>
                <td className="text-right">{n.calls.toLocaleString()}</td>
                <td className={`text-right ${n.failed ? "text-error" : "text-outline"}`}>{n.failed.toLocaleString()}</td>
                {latencyCells(n.latency).map((c, i) => (
                  <td key={i} className="text-right">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
            {test.nodes.length === 0 && (
              <tr>
                <td colSpan={6} className="text-outline font-body-sm py-1">
                  No finished runs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {test.errors.length > 0 && (
        <div className={CARD}>
          <span className={`${LABEL} block mb-1`}>Top errors</span>
          <ul className="flex flex-col gap-1">
            {test.errors.map((e) => (
              <li key={e.message} className="flex items-start gap-space-xs font-body-sm text-body-sm">
                <Icon name="error" className="text-error text-body-sm mt-0.5" />
                <span className="flex-1 text-on-surface break-words">{e.message}</span>
                <span className="font-mono text-outline">×{e.count.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const Empty = () => <div className="h-16 flex items-center justify-center font-body-sm text-body-sm text-outline">Waiting for the first runs…</div>;

/**
 * Configure and run a load test of the flow: concurrent virtual users run it back to back on the server, and
 * the report updates every second.
 */
export function LoadTestPanel({ workflowId, workflowName, environment, defaultPayload, beforeStart, onClose }: Props) {
  const [form, setForm] = useState<Form>({
    virtualUsers: "10",
    mode: "iterations",
    iterations: "100",
    durationSec: "30",
    rampUpSec: "0",
    thinkTimeMs: "0",
    maxErrorRatePct: "",
    p95Ms: "",
    payload: JSON.stringify(defaultPayload ?? {}, null, 2),
  });
  const [test, setTest] = useState<LoadTest | null>(null);
  const [history, setHistory] = useState<LoadTestSummary[]>([]);
  const [historyKey, setHistoryKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    let cancelled = false;
    fetchLoadTests(workflowId)
      .then((list) => !cancelled && setHistory(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workflowId, historyKey]);

  // Poll the running test; refresh the history once it ends.
  const runningId = test?.status === "running" ? test.id : null;
  useEffect(() => {
    if (!runningId) return;
    let cancelled = false;
    const timer = setInterval(() => {
      fetchLoadTest(runningId)
        .then((next) => {
          if (cancelled) return;
          setTest(next);
          if (next.status !== "running") setHistoryKey((k) => k + 1);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runningId]);

  const start = async () => {
    const { input, error: invalid } = toInput(form, environment);
    if (!input) {
      setError(invalid ?? "Invalid settings");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await beforeStart();
      setTest(await startLoadTest(workflowId, input));
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!test) return;
    setStopping(true);
    try {
      setTest(await stopLoadTest(test.id));
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStopping(false);
    }
  };

  const open = (id: string) => {
    setError(null);
    fetchLoadTest(id)
      .then(setTest)
      .catch((e: Error) => setError(e.message));
  };

  const editAgain = (t: LoadTest) => {
    const c = t.config;
    setForm({
      virtualUsers: String(c.virtualUsers),
      mode: c.mode,
      iterations: String(c.iterations),
      durationSec: String(c.durationSec),
      rampUpSec: String(c.rampUpSec),
      thinkTimeMs: String(c.thinkTimeMs),
      maxErrorRatePct: c.thresholds.maxErrorRatePct === undefined ? "" : String(c.thresholds.maxErrorRatePct),
      p95Ms: c.thresholds.p95Ms === undefined ? "" : String(c.thresholds.p95Ms),
      payload: JSON.stringify(c.trigger.body ?? {}, null, 2),
    });
    setTest(null);
  };

  return (
    <aside
      className="absolute right-0 top-0 h-full w-[560px] max-w-full z-50 bg-surface-container-low/97 backdrop-blur-xl shadow-2xl flex flex-col"
      aria-label="Load test"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="h-14 shrink-0 px-space-md flex items-center justify-between bg-surface-container-lowest/70">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="speed" className="text-primary text-headline-sm" />
          <div className="flex flex-col min-w-0">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold leading-tight">Load Test</span>
            <span className="font-label-sm text-label-sm text-outline truncate">{workflowName}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {test && test.status !== "running" && (
            <button
              type="button"
              onClick={() => editAgain(test)}
              className="flex items-center gap-1 px-space-sm py-1 rounded bg-surface-container-high text-on-surface font-label-md text-label-md"
            >
              <Icon name="tune" className="text-body-sm" /> New test
            </button>
          )}
          <button type="button" onClick={onClose} className="p-1 rounded text-on-surface-variant hover:text-on-surface" title="Close (a running test keeps running)">
            <Icon name="close" className="text-body-lg" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-space-md flex flex-col gap-space-md">
        {error && (
          <div className="font-body-sm text-body-sm text-error flex items-start gap-1" role="alert">
            <Icon name="error" className="text-body-md" /> {error}
          </div>
        )}

        {test ? (
          <Report test={test} onStop={stop} stopping={stopping} />
        ) : (
          <div className="flex flex-col gap-space-sm">
            <div className="grid grid-cols-2 gap-space-sm">
              <Field label="Virtual users" hint={`Concurrent runs of the flow (max ${LOAD_LIMITS.virtualUsers})`}>
                <input
                  aria-label="Virtual users"
                  className={INPUT}
                  type="number"
                  min={1}
                  max={LOAD_LIMITS.virtualUsers}
                  value={form.virtualUsers}
                  onChange={(e) => set({ virtualUsers: e.target.value })}
                />
              </Field>
              <div className="flex flex-col gap-1">
                <span className={LABEL}>Stop after</span>
                <div className="flex gap-1">
                  <div className="flex rounded bg-surface-container p-0.5 shrink-0" role="radiogroup" aria-label="Stop after">
                    {(["iterations", "duration"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={form.mode === m}
                        onClick={() => set({ mode: m })}
                        className={`px-space-xs py-0.5 rounded font-label-sm text-label-sm ${
                          form.mode === m ? "bg-surface-container-highest text-primary font-semibold" : "text-on-surface-variant"
                        }`}
                      >
                        {m === "iterations" ? "Runs" : "Time"}
                      </button>
                    ))}
                  </div>
                  {form.mode === "iterations" ? (
                    <input
                      aria-label="Iterations"
                      className={INPUT}
                      type="number"
                      min={1}
                      max={LOAD_LIMITS.iterations}
                      value={form.iterations}
                      onChange={(e) => set({ iterations: e.target.value })}
                    />
                  ) : (
                    <input
                      aria-label="Duration (seconds)"
                      className={INPUT}
                      type="number"
                      min={1}
                      max={LOAD_LIMITS.durationSec}
                      value={form.durationSec}
                      onChange={(e) => set({ durationSec: e.target.value })}
                    />
                  )}
                </div>
                <span className="font-label-sm text-label-sm text-outline">
                  {form.mode === "iterations" ? "Total flow runs across all users" : "Seconds of load"}
                </span>
              </div>
              <Field label="Ramp-up (s)" hint="Users start spread over this time">
                <input aria-label="Ramp-up" className={INPUT} type="number" min={0} max={LOAD_LIMITS.rampUpSec} value={form.rampUpSec} onChange={(e) => set({ rampUpSec: e.target.value })} />
              </Field>
              <Field label="Think time (ms)" hint="Pause between a user's runs">
                <input aria-label="Think time" className={INPUT} type="number" min={0} max={LOAD_LIMITS.thinkTimeMs} value={form.thinkTimeMs} onChange={(e) => set({ thinkTimeMs: e.target.value })} />
              </Field>
              <Field label="Max error rate (%)" hint="Optional pass/fail threshold">
                <input aria-label="Max error rate" className={INPUT} type="number" min={0} max={100} step={0.1} placeholder="none" value={form.maxErrorRatePct} onChange={(e) => set({ maxErrorRatePct: e.target.value })} />
              </Field>
              <Field label="Max p95 (ms)" hint="Optional pass/fail threshold">
                <input aria-label="Max p95" className={INPUT} type="number" min={1} placeholder="none" value={form.p95Ms} onChange={(e) => set({ p95Ms: e.target.value })} />
              </Field>
            </div>

            <Field label="Trigger payload (JSON)" hint="Every run receives this as {{trigger.body}}">
              <textarea
                aria-label="Trigger payload"
                className={`${INPUT} h-28 resize-y leading-relaxed`}
                spellCheck={false}
                value={form.payload}
                onChange={(e) => set({ payload: e.target.value })}
              />
            </Field>

            <div className={`${CARD} font-body-sm text-body-sm text-on-surface-variant flex flex-col gap-1`}>
              <span>
                Environment: <span className="text-on-surface font-semibold">{ENVIRONMENT_LABELS[environment].label}</span>{" "}
                <span className="text-outline">(switch it in the header)</span>
              </span>
              {environment === "production" && (
                <span className="text-tertiary flex items-start gap-1">
                  <Icon name="warning" className="text-body-sm mt-0.5" /> This sends real load to production endpoints.
                </span>
              )}
              <span className="text-outline">
                Load is generated from the Reqora server. Runs aren&apos;t saved to Execution History; linked requests run their scripts
                on every run, including rq.environment.set.
              </span>
            </div>

            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-primary text-on-primary rounded-xl font-body-sm text-body-sm font-semibold hover:bg-primary-container disabled:opacity-60"
            >
              <Icon name={busy ? "progress_activity" : "rocket_launch"} className={`text-body-md ${busy ? "animate-spin" : ""}`} />
              Start load test
            </button>
          </div>
        )}

        <div className="flex flex-col gap-space-xs">
          <span className={LABEL}>Recent load tests</span>
          {history.length === 0 && <span className="font-body-sm text-body-sm text-outline">None yet.</span>}
          {history.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => open(h.id)}
              className={`flex items-center gap-space-xs px-space-xs py-1 rounded text-left hover:bg-surface-container-high ${
                test?.id === h.id ? "bg-surface-container-high" : ""
              }`}
            >
              <StatusBadge test={h} />
              <span className="font-body-sm text-body-sm text-on-surface flex-1 truncate">
                {new Date(h.startedAt).toLocaleString()} · {h.virtualUsers} users · {h.iterations.completed.toLocaleString()} runs
              </span>
              <span className="font-mono text-label-sm text-outline shrink-0">
                {h.throughput} it/s · {h.errorRatePct}% err · p95 {h.p95Ms === null ? "—" : ms(h.p95Ms)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
