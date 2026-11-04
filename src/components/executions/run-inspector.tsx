"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import type { Run, Step } from "@/lib/workflows/schema";
import { shortId, urlPath, utcTime } from "./format";

type Tab = "payloads" | "headers" | "logs";
type StepTone = "tertiary" | "primary" | "secondary" | "error" | "skipped";

const TAB_BASE =
  "px-space-sm py-space-xs rounded font-label-md text-label-md flex items-center gap-space-xxs transition-colors";
const TAB_ACTIVE = `${TAB_BASE} bg-surface-container-high text-primary font-semibold`;
const TAB_IDLE = `${TAB_BASE} hover:bg-surface-container-high text-on-surface-variant`;
const CODE = "overflow-auto max-h-80 font-mono leading-relaxed select-all whitespace-pre";

const STEP_STYLES: Record<StepTone, { row: string; num: string; name: string; chip: string; result: string; duration: string; bar: string; verdict: string }> = {
  tertiary: {
    row: "bg-surface-container-high hover:bg-surface-container-highest cursor-pointer transition-colors",
    num: "bg-tertiary-container text-on-tertiary-container",
    name: "text-tertiary font-medium",
    chip: "bg-surface-container-lowest text-outline",
    result: "text-primary",
    duration: "text-outline font-mono",
    bar: "bg-primary",
    verdict: "OK",
  },
  primary: {
    row: "bg-surface-container-high hover:bg-surface-container-highest cursor-pointer transition-colors",
    num: "bg-primary/20 text-primary",
    name: "text-on-surface font-medium",
    chip: "bg-surface-container-lowest text-primary",
    result: "text-primary",
    duration: "text-outline font-mono",
    bar: "bg-primary",
    verdict: "OK",
  },
  secondary: {
    row: "bg-surface-container-high hover:bg-surface-container-highest cursor-pointer transition-colors",
    num: "bg-secondary-container text-on-secondary-container",
    name: "text-on-surface font-medium",
    chip: "bg-surface-container-lowest text-secondary",
    result: "text-secondary",
    duration: "text-outline font-mono",
    bar: "bg-secondary",
    verdict: "Evaluated",
  },
  error: {
    row: "bg-error-container/20 hover:bg-error-container/30 cursor-pointer transition-colors shadow-sm",
    num: "bg-error-container text-on-error-container",
    name: "text-error font-bold flex items-center gap-space-xxs",
    chip: "bg-error-container/50 text-error",
    result: "text-error font-bold",
    duration: "text-error font-mono font-bold",
    bar: "bg-error",
    verdict: "Failed",
  },
  skipped: {
    row: "bg-surface-container-lowest/60 opacity-60 cursor-not-allowed",
    num: "bg-surface-container-highest text-outline",
    name: "text-outline",
    chip: "bg-surface-container-highest text-outline",
    result: "text-outline",
    duration: "text-outline",
    bar: "",
    verdict: "Skipped",
  },
};

function toneOf(step: Step): StepTone {
  if (step.status === "failed") return "error";
  if (step.status === "skipped") return "skipped";
  if (step.nodeType === "webhook") return "tertiary";
  if (step.nodeType === "condition") return "secondary";
  return "primary";
}

const responseOf = (step: Step) => step.output as { status?: number; headers?: Record<string, string>; body?: unknown } | undefined;

function stepDetail(step: Step) {
  if (step.request) return `${step.request.method} ${urlPath(step.request.url)}`;
  if (step.nodeType === "webhook") return "trigger payload";
  return step.nodeType;
}

function stepResult(step: Step) {
  if (step.status === "skipped") return "SKIPPED (branch not taken or upstream error)";
  const status = responseOf(step)?.status;
  if (step.status === "failed") return status ? `${status} FAILED` : "FAILED";
  if (step.nodeType === "condition") return step.port?.toUpperCase();
  return status ? `${status} OK` : "OK";
}

/** What went into a step: the HTTP request, or the trigger payload for the webhook. */
function stepInput(step: Step, run: Run): unknown {
  if (step.request) return step.request;
  if (step.nodeType === "webhook") return run.trigger.body ?? null;
  return undefined;
}

const json = (value: unknown) => JSON.stringify(value, null, 2) ?? "undefined";

function logLines(run: Run) {
  const start = Date.parse(run.startedAt);
  return run.steps.map((step) => {
    const at = `+${Math.max(0, Date.parse(step.startedAt) - start)}ms`.padStart(7);
    const what = `${step.nodeId} (${step.name})`;
    if (step.status === "skipped") return { text: `[${at}] SKIP  ${what}`, className: "text-outline" };
    if (step.status === "failed") return { text: `[${at}] FAIL  ${what} — ${step.error}`, className: "text-error" };
    const extra = step.request ? ` ${step.request.method} ${step.request.url} → ${responseOf(step)?.status}` : step.port ? ` → ${step.port}` : "";
    return { text: `[${at}] OK    ${what}${extra} (${step.durationMs}ms)`, className: "text-on-surface-variant" };
  });
}

type RunInspectorProps = {
  run: Run | undefined;
  workflowName: string | undefined;
  replaying: boolean;
  onReplay: () => void;
};

export function RunInspector({ run, workflowName, replaying, onReplay }: RunInspectorProps) {
  const [tab, setTab] = useState<Tab>("payloads");
  const [chosen, setChosen] = useState<{ runId: string; nodeId: string } | null>(null);

  if (!run) {
    return (
      <div className="lg:col-span-7 flex items-center justify-center min-h-96 bg-surface-container-low rounded-lg p-space-sm shadow-md text-outline font-body-sm text-body-sm">
        Select a run to inspect its trace.
      </div>
    );
  }

  const failedStep = run.steps.find((s) => s.status === "failed");
  // Default to the failing step, otherwise the last executed one.
  const fallback = failedStep ?? [...run.steps].reverse().find((s) => s.status !== "skipped") ?? run.steps[0];
  const viewing = (chosen?.runId === run.id && run.steps.find((s) => s.nodeId === chosen.nodeId)) || fallback;
  const viewingIndex = run.steps.indexOf(viewing);
  const response = responseOf(viewing);
  const input = stepInput(viewing, run);
  const logs = logLines(run);
  const start = Date.parse(run.startedAt);
  const total = Math.max(1, run.durationMs);

  const copyText: Record<Tab, string> = {
    payloads: json({ input, output: viewing.output, error: viewing.error }),
    headers: json({ request: viewing.request?.headers ?? {}, response: response?.headers ?? {} }),
    logs: logs.map((l) => l.text).join("\n"),
  };

  return (
    <div className="lg:col-span-7 flex flex-col gap-space-sm bg-surface-container-low rounded-lg p-space-sm shadow-md">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-space-xs bg-surface-container-lowest/50 p-space-sm rounded-lg gap-space-sm">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="font-headline-md text-headline-md text-on-surface font-bold font-mono">{shortId(run.id)}</span>
            <span
              className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm font-bold ${
                run.status === "failed" ? "bg-error-container text-on-error-container" : "bg-primary/20 text-primary"
              }`}
            >
              {run.status.toUpperCase()}
            </span>
            <span className="font-label-sm text-label-sm text-outline font-mono">{utcTime(run.startedAt)}</span>
            <span
              className={`px-space-xs py-space-xxs rounded bg-surface-container-highest font-label-sm text-label-sm uppercase ${
                ENVIRONMENT_LABELS[run.environment].tone
              }`}
            >
              {ENVIRONMENT_LABELS[run.environment].label}
            </span>
          </div>
          <div className="flex items-center gap-space-xs mt-space-xxs text-on-surface-variant font-body-sm text-body-sm min-w-0">
            {run.error ? (
              <>
                <span>Root Cause:</span>
                <span className="text-error font-medium truncate" title={run.error}>
                  Step {run.steps.indexOf(failedStep!) + 1} — {run.error}
                </span>
              </>
            ) : (
              <span className="truncate">
                {workflowName ?? run.workflowId} · v{run.workflowVersion} · {run.trigger.source} trigger
                {run.replayOf && <> · replay of {shortId(run.replayOf)}</>}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-space-xs flex-shrink-0">
          <Link
            href={`/flow/${run.workflowId}`}
            className="px-space-sm py-space-xs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-body-sm text-body-sm transition-colors flex items-center gap-space-xxs"
          >
            <Icon name="schema" className="text-body-md" />
            Open in Canvas
          </Link>
          <button
            className="px-space-sm py-space-xs rounded font-body-sm text-body-sm font-semibold transition-all shadow-sm flex items-center gap-space-xxs active:scale-95 bg-primary text-on-primary hover:bg-primary-container disabled:opacity-70"
            disabled={replaying}
            onClick={onReplay}
            title="Re-run this trigger payload against the workflow's current version"
            type="button"
          >
            <Icon name={replaying ? "refresh" : "replay"} className={`text-body-md ${replaying ? "animate-spin" : ""}`} />
            {replaying ? "Replaying…" : "Replay Run"}
          </button>
        </div>
      </div>

      {/* Waterfall */}
      <div className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-inner">
        <div className="flex items-center justify-between pb-space-xs">
          <div className="flex items-center gap-space-xs">
            <Icon name="waterfall_chart" className="text-primary text-body-lg" />
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Execution Flow Waterfall</span>
          </div>
          <span className="font-label-sm text-label-sm text-outline font-mono">Total Execution Time: {run.durationMs}ms</span>
        </div>
        <div className="flex flex-col gap-space-xs mt-space-xs font-mono">
          {run.steps.map((step, i) => {
            const tone = toneOf(step);
            const s = STEP_STYLES[tone];
            const skipped = tone === "skipped";
            const offset = ((Date.parse(step.startedAt) - start) / total) * 100;
            const width = Math.max(1, (step.durationMs / total) * 100);
            const select = () => setChosen({ runId: run.id, nodeId: step.nodeId });
            return (
              <div
                key={step.nodeId}
                aria-disabled={skipped || undefined}
                aria-pressed={step === viewing}
                className={`flex flex-col p-space-xs rounded ${s.row} ${step === viewing ? "ring-1 ring-primary/50" : ""}`}
                onClick={skipped ? undefined : select}
                onKeyDown={(e) => {
                  if (!skipped && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    select();
                  }
                }}
                role="button"
                tabIndex={skipped ? -1 : 0}
              >
                <div className="flex items-center justify-between gap-space-xs font-body-sm text-body-sm">
                  <div className="flex items-center gap-space-xs min-w-0">
                    <span className={`w-5 h-5 shrink-0 rounded-full flex items-center justify-center font-label-sm text-label-sm font-bold ${s.num}`}>
                      {i + 1}
                    </span>
                    <span className={`${s.name} truncate`}>
                      {tone === "error" && <Icon name="warning" className="text-body-sm" />}
                      {step.name}
                    </span>
                    <span className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm truncate ${s.chip}`}>
                      {stepDetail(step)}
                    </span>
                  </div>
                  <div className="flex items-center gap-space-sm flex-shrink-0">
                    <span className={`font-label-sm text-label-sm ${s.result}`}>{stepResult(step)}</span>
                    <span className={`font-label-sm text-label-sm ${s.duration}`}>{step.durationMs}ms</span>
                  </div>
                </div>
                {!skipped && (
                  <div className="w-full bg-surface-container-lowest h-1.5 rounded-full mt-space-xs overflow-hidden">
                    <div
                      className={`${s.bar} h-full rounded-full`}
                      style={{ width: `${Math.min(width, 100 - offset)}%`, marginLeft: `${Math.min(offset, 99)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Deep dive tabs */}
      <div className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-inner mt-space-xs">
        <div className="flex items-center justify-between pb-space-xs gap-space-xs">
          <div className="flex items-center gap-space-xs overflow-x-auto" role="tablist">
            {(
              [
                { id: "payloads", icon: "data_object", label: "Step Payloads" },
                { id: "headers", icon: "http", label: "Raw Headers" },
                { id: "logs", icon: "terminal", label: "Console Logs", alert: run.status === "failed" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                aria-selected={tab === t.id}
                className={tab === t.id ? TAB_ACTIVE : TAB_IDLE}
                onClick={() => setTab(t.id)}
                role="tab"
                type="button"
              >
                <Icon name={t.icon} className="text-body-md" />
                {t.label}
                {"alert" in t && t.alert && <span className="w-2 h-2 rounded-full bg-error" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-space-xs shrink-0">
            <span className="font-label-sm text-label-sm text-outline font-mono">
              Viewing: Step {viewingIndex + 1} ({STEP_STYLES[toneOf(viewing)].verdict})
            </span>
            <button
              className="p-space-xxs rounded hover:bg-surface-container-high text-outline hover:text-on-surface"
              onClick={() => void navigator.clipboard?.writeText(copyText[tab])}
              title="Copy as JSON / text"
              type="button"
            >
              <Icon name="content_copy" className="text-body-md" />
            </button>
          </div>
        </div>

        {tab === "payloads" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm pt-space-xs font-code-block text-code-block" role="tabpanel">
            <div className="flex flex-col bg-surface-container-lowest rounded p-space-sm shadow-sm min-w-0">
              <div className="flex items-center justify-between pb-space-xxs mb-space-xxs text-outline font-label-sm text-label-sm uppercase">
                <span className="flex items-center gap-space-xxs">
                  <Icon name="input" className="text-primary text-body-md" />
                  {viewing.request ? "Request" : "Input"}
                </span>
                {input !== undefined && <span>JSON ({new TextEncoder().encode(json(input)).length} bytes)</span>}
              </div>
              <pre className={`${CODE} text-on-surface-variant`}>
                {input === undefined ? `// ${viewing.nodeType} nodes read from earlier steps via templates` : json(input)}
              </pre>
            </div>
            <div className="flex flex-col bg-surface-container-lowest rounded p-space-sm shadow-sm min-w-0">
              <div
                className={`flex items-center justify-between pb-space-xxs mb-space-xxs font-label-sm text-label-sm uppercase ${
                  viewing.status === "failed" ? "text-error" : "text-outline"
                }`}
              >
                <span className="flex items-center gap-space-xxs">
                  <Icon name="output" className={`${viewing.status === "failed" ? "text-error" : "text-primary"} text-body-md`} />
                  {viewing.status === "failed" ? "Error Response" : "Output"}
                </span>
                {response?.status !== undefined && <span className="font-mono">Status: {response.status}</span>}
              </div>
              {viewing.error && <div className="text-error font-mono mb-space-xs">{viewing.error}</div>}
              <pre className={`${CODE} text-on-surface`}>
                {viewing.status === "skipped" ? "// skipped — not executed in this run" : json(viewing.output ?? null)}
              </pre>
            </div>
          </div>
        )}

        {tab === "headers" && (
          <div className="pt-space-xs font-code-block text-code-block" role="tabpanel">
            <div className="bg-surface-container-lowest rounded p-space-sm flex flex-col gap-space-xs font-mono">
              <span className="font-label-sm text-label-sm text-outline uppercase">Request Headers (templates, unresolved)</span>
              <HeaderList headers={viewing.request?.headers} />
              <div className="w-full h-px bg-surface-variant my-space-xs" />
              <span className={`font-label-sm text-label-sm uppercase ${viewing.status === "failed" ? "text-error" : "text-outline"}`}>
                Response Headers
              </span>
              <HeaderList headers={response?.headers} />
            </div>
          </div>
        )}

        {tab === "logs" && (
          <div className="pt-space-xs font-code-block text-code-block" role="tabpanel">
            <div className="bg-surface-container-lowest rounded p-space-sm font-mono space-y-space-xxs max-h-56 overflow-auto whitespace-pre">
              {logs.map((log) => (
                <div key={log.text} className={log.className}>
                  {log.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Debugger hint bar */}
      <div className="flex items-center justify-between gap-space-sm p-space-sm bg-surface-container-lowest/80 rounded-lg">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name={failedStep ? "bug_report" : "task_alt"} className={`${failedStep ? "text-error" : "text-primary"} text-body-lg`} />
          <span className="font-body-sm text-body-sm text-on-surface truncate">
            {failedStep
              ? `Step ${run.steps.indexOf(failedStep) + 1} failed. Fix the node in the canvas, then replay this payload.`
              : "Every executed step succeeded."}
          </span>
        </div>
        {failedStep && (
          <Link
            href={`/flow/${run.workflowId}`}
            className="px-space-sm py-space-xs rounded bg-primary-container text-on-primary-container hover:bg-primary font-label-md text-label-md font-semibold transition-colors shrink-0"
          >
            Fix in Canvas
          </Link>
        )}
      </div>
    </div>
  );
}

function HeaderList({ headers }: { headers: Record<string, string> | undefined }) {
  const entries = Object.entries(headers ?? {});
  if (entries.length === 0) return <div className="text-outline">—</div>;
  return (
    <div className="text-on-surface-variant space-y-space-xxs">
      {entries.map(([name, value]) => (
        <div key={name} className="break-all">
          <span className="text-outline">{name}:</span> <span className={value.includes("{{env.") ? "text-tertiary" : ""}>{value}</span>
        </div>
      ))}
    </div>
  );
}
