"use client";

import { Fragment, useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  CONSOLE_LOGS,
  ERROR_PAYLOAD,
  INPUT_PAYLOAD,
  REQUEST_HEADERS,
  RESPONSE_HEADERS,
  TRACE_STEPS,
  type CodeLine,
  type HeaderLine,
  type StepTone,
  type TraceStep,
} from "./data";

type Tab = "payloads" | "headers" | "logs";
type ReplayPhase = "idle" | "dispatching" | "queued";

const TABS: { id: Tab; icon: string; label: string; alert?: boolean }[] = [
  { id: "payloads", icon: "data_object", label: "Step Payloads (Diff)" },
  { id: "headers", icon: "http", label: "Raw Headers" },
  { id: "logs", icon: "terminal", label: "Console Logs", alert: true },
];

const TAB_BASE =
  "px-space-sm py-space-xs rounded font-label-md text-label-md flex items-center gap-space-xxs transition-colors";
const TAB_ACTIVE = `${TAB_BASE} bg-surface-container-high text-primary font-semibold`;
const TAB_IDLE = `${TAB_BASE} hover:bg-surface-container-high text-on-surface-variant`;

const STEP_STYLES: Record<
  StepTone,
  { row: string; num: string; name: string; chip: string; result: string; duration: string; bar: string; verdict: string }
> = {
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
    verdict: "Matched",
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

const codeText = (lines: CodeLine[]) => lines.map((l) => l.map(([t]) => t).join("")).join("\n");
const headerText = (lines: HeaderLine[]) =>
  lines.map((h) => (h.name ? `${h.name} ${h.value}` : h.value)).join("\n");

const COPY_TEXT: Record<Tab, string> = {
  payloads: codeText(INPUT_PAYLOAD),
  headers: `${headerText(REQUEST_HEADERS)}\n\n${headerText(RESPONSE_HEADERS)}`,
  logs: CONSOLE_LOGS.map((l) => l.text).join("\n"),
};

export function RunInspector() {
  const [tab, setTab] = useState<Tab>("payloads");
  const [stepN, setStepN] = useState(4);
  const [replay, setReplay] = useState<ReplayPhase>("idle");

  useEffect(() => {
    if (replay === "idle") return;
    const timer = setTimeout(
      () => setReplay(replay === "dispatching" ? "queued" : "idle"),
      replay === "dispatching" ? 1000 : 2400,
    );
    return () => clearTimeout(timer);
  }, [replay]);

  const viewing = TRACE_STEPS.find((s) => s.n === stepN) ?? TRACE_STEPS[3];

  return (
    <div className="lg:col-span-7 flex flex-col gap-space-sm bg-surface-container-low rounded-lg p-space-sm shadow-md">
      {/* Execution Inspector Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-space-xs bg-surface-container-lowest/50 p-space-sm rounded-lg gap-space-sm">
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="font-headline-md text-headline-md text-on-surface font-bold font-mono">#run_893fa02</span>
            <span className="px-space-xs py-space-xxs rounded bg-error-container text-on-error-container font-label-sm text-label-sm font-bold">
              500 FAILED
            </span>
            <span className="font-label-sm text-label-sm text-outline font-mono">12:48:19.402 UTC</span>
          </div>
          <div className="flex items-center gap-space-xs mt-space-xxs text-on-surface-variant font-body-sm text-body-sm">
            <span>Root Cause:</span>
            <span className="text-error font-medium truncate">Step 4 (Inventory Sync) Gateway Timeout</span>
          </div>
        </div>
        {/* Quick Actions */}
        <div className="flex items-center gap-space-xs flex-shrink-0">
          <button
            className="px-space-sm py-space-xs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-body-sm text-body-sm transition-colors flex items-center gap-space-xxs"
            type="button"
          >
            <Icon name="share" className="text-body-md" />
            Share Run
          </button>
          <button
            className={`px-space-sm py-space-xs rounded font-body-sm text-body-sm font-semibold transition-all shadow-sm flex items-center gap-space-xxs active:scale-95 ${
              replay === "queued"
                ? "bg-tertiary text-on-tertiary hover:bg-primary-container"
                : "bg-primary text-on-primary hover:bg-primary-container"
            } ${replay === "idle" ? "" : "opacity-80 pointer-events-none"}`}
            disabled={replay !== "idle"}
            onClick={() => setReplay("dispatching")}
            type="button"
          >
            {replay === "idle" && (
              <>
                <Icon name="replay" className="text-body-md fill-current" />
                Replay Flow from this step
              </>
            )}
            {replay === "dispatching" && (
              <>
                <Icon name="refresh" className="text-body-md animate-spin" /> Dispatching Re-run...
              </>
            )}
            {replay === "queued" && (
              <>
                <Icon name="check" className="text-body-md" /> Run Queued #run_893fa03
              </>
            )}
          </button>
        </div>
      </div>

      {/* Waterfall Timeline Trace Visualization */}
      <div className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-inner">
        <div className="flex items-center justify-between pb-space-xs">
          <div className="flex items-center gap-space-xs">
            <Icon name="waterfall_chart" className="text-primary text-body-lg" />
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Execution Flow Waterfall
            </span>
          </div>
          <span className="font-label-sm text-label-sm text-outline font-mono">Total Execution Time: 384ms</span>
        </div>
        <div className="flex flex-col gap-space-xs mt-space-xs font-mono">
          {TRACE_STEPS.map((step) => (
            <StepRow key={step.n} step={step} onSelect={() => setStepN(step.n)} />
          ))}
        </div>
      </div>

      {/* Deep Dive Inspector Panel with Tabs */}
      <div className="flex flex-col bg-surface-container rounded-lg p-space-sm shadow-inner mt-space-xs">
        <div className="flex items-center justify-between pb-space-xs">
          <div className="flex items-center gap-space-xs overflow-x-auto" role="tablist">
            {TABS.map((t) => (
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
                {t.alert && <span className="w-2 h-2 rounded-full bg-error" />}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-outline font-mono">
              Viewing: Step {viewing.n} ({STEP_STYLES[viewing.tone].verdict})
            </span>
            <button
              className="p-space-xxs rounded hover:bg-surface-container-high text-outline hover:text-on-surface"
              onClick={() => void navigator.clipboard?.writeText(COPY_TEXT[tab])}
              title="Copy raw payload"
              type="button"
            >
              <Icon name="content_copy" className="text-body-md" />
            </button>
          </div>
        </div>

        {tab === "payloads" && (
          <div className="flex flex-col gap-space-xs pt-space-xs" role="tabpanel">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm font-code-block text-code-block">
              {/* Left: Node Input */}
              <div className="flex flex-col bg-surface-container-lowest rounded p-space-sm shadow-sm">
                <div className="flex items-center justify-between pb-space-xxs mb-space-xxs text-outline font-label-sm text-label-sm uppercase">
                  <span className="flex items-center gap-space-xxs">
                    <Icon name="input" className="text-primary text-body-md" />
                    Input Payload
                  </span>
                  <span className="text-outline">JSON (294 bytes)</span>
                </div>
                <CodeBlock
                  className="overflow-x-auto text-on-surface-variant font-mono leading-relaxed select-all"
                  lines={INPUT_PAYLOAD}
                />
              </div>
              {/* Right: Node Output / Error Diff */}
              <div className="flex flex-col bg-surface-container-lowest rounded p-space-sm shadow-sm">
                <div className="flex items-center justify-between pb-space-xxs mb-space-xxs text-error font-label-sm text-label-sm uppercase">
                  <span className="flex items-center gap-space-xxs">
                    <Icon name="output" className="text-error text-body-md" />
                    Error Response
                  </span>
                  <span className="text-error font-mono">Status: 504 Gateway Timeout</span>
                </div>
                <CodeBlock
                  className="overflow-x-auto text-on-surface font-mono leading-relaxed select-all"
                  lines={ERROR_PAYLOAD}
                />
              </div>
            </div>
          </div>
        )}

        {tab === "headers" && (
          <div className="flex-col gap-space-xs pt-space-xs font-code-block text-code-block" role="tabpanel">
            <div className="bg-surface-container-lowest rounded p-space-sm flex flex-col gap-space-xs">
              <span className="font-label-sm text-label-sm text-outline uppercase">Request Headers &amp; Meta</span>
              <HeaderList lines={REQUEST_HEADERS} />
              <div className="w-full h-px bg-surface-variant my-space-xs" />
              <span className="font-label-sm text-label-sm text-error uppercase">Response Headers</span>
              <HeaderList lines={RESPONSE_HEADERS} />
            </div>
          </div>
        )}

        {tab === "logs" && (
          <div className="flex-col gap-space-xs pt-space-xs font-code-block text-code-block" role="tabpanel">
            <div className="bg-surface-container-lowest rounded p-space-sm font-mono space-y-space-xxs max-h-56 overflow-y-auto">
              {CONSOLE_LOGS.map((log) => (
                <div key={log.text} className={log.className}>
                  {log.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Action Floating Bar for Node Debugger */}
      <div className="flex items-center justify-between p-space-sm bg-surface-container-lowest/80 rounded-lg">
        <div className="flex items-center gap-space-xs">
          <Icon name="bug_report" className="text-primary text-body-lg" />
          <span className="font-body-sm text-body-sm text-on-surface">
            Step 4 failed: Would you like to patch parameters or inject mock response?
          </span>
        </div>
        <div className="flex items-center gap-space-xs">
          <button
            className="px-space-sm py-space-xs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-label-md transition-colors"
            type="button"
          >
            Mock Step Output
          </button>
          <button
            className="px-space-sm py-space-xs rounded bg-primary-container text-on-primary-container hover:bg-primary font-label-md text-label-md font-semibold transition-colors"
            type="button"
          >
            Configure Retries &amp; Fallback
          </button>
        </div>
      </div>
    </div>
  );
}

function StepRow({ step, onSelect }: { step: TraceStep; onSelect: () => void }) {
  const s = STEP_STYLES[step.tone];
  const skipped = step.tone === "skipped";

  return (
    <div
      aria-disabled={skipped || undefined}
      className={`flex flex-col p-space-xs rounded ${s.row}`}
      onClick={skipped ? undefined : onSelect}
      onKeyDown={(e) => {
        if (!skipped && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onSelect();
        }
      }}
      role="button"
      tabIndex={skipped ? -1 : 0}
    >
      <div className="flex items-center justify-between font-body-sm text-body-sm">
        <div className="flex items-center gap-space-xs min-w-0">
          <span
            className={`w-5 h-5 rounded-full flex items-center justify-center font-label-sm text-label-sm font-bold ${s.num}`}
          >
            {step.n}
          </span>
          <span className={s.name}>
            {step.tone === "error" && <Icon name="warning" className="text-body-sm" />}
            {step.name}
          </span>
          <span className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm ${s.chip}`}>
            {step.detail}
          </span>
        </div>
        <div className="flex items-center gap-space-sm flex-shrink-0">
          {step.result && <span className={`font-label-sm text-label-sm ${s.result}`}>{step.result}</span>}
          <span className={`font-label-sm text-label-sm ${s.duration}`}>{step.duration}</span>
        </div>
      </div>
      {step.bar && (
        <div className="w-full bg-surface-container-lowest h-1.5 rounded-full mt-space-xs overflow-hidden">
          <div
            className={`${s.bar} h-full rounded-full`}
            style={{ width: step.bar.width, marginLeft: step.bar.offset }}
          />
        </div>
      )}
    </div>
  );
}

function CodeBlock({ lines, className }: { lines: CodeLine[]; className: string }) {
  return (
    <pre className={className}>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && "\n"}
          {line.map(([text, cls], j) =>
            cls ? (
              <span key={j} className={cls}>
                {text}
              </span>
            ) : (
              <Fragment key={j}>{text}</Fragment>
            ),
          )}
        </Fragment>
      ))}
    </pre>
  );
}

function HeaderList({ lines }: { lines: HeaderLine[] }) {
  return (
    <div className="font-mono text-on-surface-variant space-y-space-xxs">
      {lines.map((h) => (
        <div key={`${h.name ?? ""}${h.value}`}>
          {h.name ? (
            <>
              <span className={h.nameClass ?? "text-outline"}>{h.name}</span> {h.value}
            </>
          ) : (
            <span className={h.valueClass}>{h.value}</span>
          )}
        </div>
      ))}
    </div>
  );
}
