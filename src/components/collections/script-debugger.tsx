"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { javascript } from "@codemirror/lang-javascript";
import { syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { Icon } from "@/components/icon";
import { breakpointKey, setBreakpoints, useBreakpoints } from "@/lib/collections/breakpoints";
import type { DebugState, DebugValue, ScriptDebug } from "@/lib/collections/script-debug";
import { breakpointGutter, debugHighlights, showDebugLines, syncBreakpoints } from "./breakpoint-gutter";
import { highlight, theme } from "./script-code-editor";

/** Where a recording's breakpoints are kept; by default its scope, name and phase (as the script editors key them). */
export type BreakpointKeyFor = (trace: ScriptDebug, index: number) => string | null;
const defaultKey: BreakpointKeyFor = (t) => breakpointKey(t.scope, t.source, t.phase);
type LabelFor = (trace: ScriptDebug, index: number) => string;

const PHASE: Record<ScriptDebug["phase"], string> = { pre: "Pre-request", post: "Post-response" };
export const traceLabel = (t: ScriptDebug) =>
  t.source === "script node" ? "Script" : t.source === "repeat until" ? "Repeat until" : `${PHASE[t.phase]} · ${t.scope} “${t.source}”`;

const LEVEL_TONE = { log: "text-on-surface", info: "text-secondary", warn: "text-tertiary", error: "text-error" } as const;

/** Steps through recorded script runs (Debug): the code with the current line, variables, rq changes and console. */
export function ScriptDebugger({
  traces,
  keyFor = defaultKey,
  labelFor = traceLabel,
  className = "",
}: {
  traces: ScriptDebug[];
  keyFor?: BreakpointKeyFor;
  labelFor?: LabelFor;
  className?: string;
}) {
  // A failed script is the likely reason to debug: open it first.
  const [selected, setSelected] = useState(() => Math.max(0, traces.findIndex((t) => t.error)));
  const index = Math.min(selected, traces.length - 1);
  const trace = traces[index];
  if (!trace) return <p className="p-space-sm text-on-surface-variant font-body-sm text-body-sm">No scripts ran in this debug run.</p>;
  return (
    <div className={`flex flex-col min-h-0 ${className}`} data-testid="script-debugger">
      {traces.length > 1 && (
        <div className="flex items-center gap-space-xxs px-space-sm pt-space-xs flex-wrap" role="tablist" aria-label="Scripts">
          {traces.map((t, i) => (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={t === trace}
              onClick={() => setSelected(i)}
              className={`px-space-xs py-0.5 rounded font-label-sm text-label-sm flex items-center gap-1 ${
                t === trace ? "bg-primary/15 text-primary" : "text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              {t.error && <Icon name="error" className="text-body-sm text-error" />}
              {labelFor(t, i)}
            </button>
          ))}
        </div>
      )}
      <TraceView key={`${index}:${traces.length}`} trace={trace} storeKey={keyFor(trace, index)} />
    </div>
  );
}

function TraceView({ trace, storeKey }: { trace: ScriptDebug; storeKey: string | null }) {
  const [breakpoints] = useBreakpoints(storeKey);
  const steps = trace.steps;
  const last = steps.length - 1;
  const errorStep = trace.error?.step ?? -1;
  const stops = (i: number) => steps[i].pause === true || breakpoints.includes(steps[i].line) || i === errorStep;
  const nextStop = (from: number) => {
    for (let i = from + 1; i <= last; i++) if (stops(i)) return i;
    return last;
  };
  // Start at the first breakpoint (or debugger;) when there is one, else at the first step.
  const [index, setIndex] = useState(() => {
    for (let i = 0; i <= last; i++) if (steps[i].pause || breakpoints.includes(steps[i].line)) return i;
    return 0;
  });
  const at = Math.min(index, last);
  const step = steps[at];
  const prev = at > 0 ? steps[at - 1] : undefined;

  const go = (i: number) => setIndex(Math.max(0, Math.min(last, i)));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "F10") go(e.shiftKey ? at - 1 : at + 1);
    else if (e.key === "F8") go(nextStop(at));
    else return;
    e.preventDefault();
  };

  const vars = step ? Object.entries(step.vars) : [];
  const state = step ? trace.states[step.state] : undefined;
  const prevState = prev ? trace.states[prev.state] : undefined;

  return (
    <div className="flex-1 flex flex-col min-h-0 outline-none" tabIndex={-1} onKeyDown={onKey}>
      <div className="px-space-sm py-space-xs flex items-center gap-space-xs flex-wrap border-b border-outline-variant/40">
        <ToolButton icon="replay" label="Restart" title="Back to the first step" onClick={() => go(0)} disabled={!step || at === 0} />
        <ToolButton icon="chevron_left" label="Step back" title="Step back (Shift+F10)" onClick={() => go(at - 1)} disabled={!step || at === 0} />
        <ToolButton icon="chevron_right" label="Step" title="Next step (F10)" onClick={() => go(at + 1)} disabled={!step || at === last} primary />
        <ToolButton icon="play_arrow" label="Continue" title="Run to the next breakpoint, debugger; or error (F8)" onClick={() => go(nextStop(at))} disabled={!step || at === last} />
        <ToolButton icon="last_page" label="End" title="Go to the end" onClick={() => go(last)} disabled={!step || at === last} />
        {step && (
          <>
            <input
              type="range"
              min={0}
              max={last}
              value={at}
              onChange={(e) => go(Number(e.target.value))}
              aria-label="Step"
              className="flex-1 min-w-24 max-w-64 accent-[var(--color-primary)]"
            />
            <span className="font-label-sm text-label-sm text-on-surface-variant" data-testid="debug-position">
              Step {at + 1} of {steps.length} · {step.end ? (trace.error ? "stopped" : "finished") : `line ${step.line}`}
            </span>
          </>
        )}
        <span className="ml-auto font-label-sm text-label-sm text-outline hidden lg:inline">Click the gutter to set breakpoints</span>
      </div>

      {trace.note && <Notice tone="warn">{trace.note}</Notice>}
      {trace.truncated && (
        <Notice tone="warn">
          Recording stopped after {steps.length - 1} steps (a long loop or large values). The script itself ran to the end; set a breakpoint
          earlier or log less to see the rest.
        </Notice>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(16rem,42%)]">
        <CodeView code={trace.code} current={step && !step.end ? step.line : null} error={errorStep >= 0 ? steps[errorStep]?.line ?? null : null} storeKey={storeKey} />
        <div className="min-h-0 overflow-y-auto border-t md:border-t-0 md:border-l border-outline-variant/40 p-space-sm flex flex-col gap-space-sm">
          {trace.error && (
            <div role="alert" className="flex items-start gap-space-xs p-space-xs rounded bg-error-container/30 text-on-error-container">
              <Icon name="error" className="text-body-md text-error" />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="font-code-block text-code-block break-all whitespace-pre-wrap">{trace.error.message}</span>
                {at !== errorStep && steps[errorStep] && (
                  <button type="button" onClick={() => go(errorStep)} className="self-start font-label-sm text-label-sm text-primary hover:underline">
                    Go to line {steps[errorStep].line}
                  </button>
                )}
              </div>
            </div>
          )}
          {step?.end && (
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {trace.error ? "The script stopped with the error above." : "The script finished."} Variables show their values at the last recorded step.
            </p>
          )}
          <Section title="Variables" testId="debug-variables">
            {vars.length === 0 ? (
              <p className="text-outline font-body-sm text-body-sm">{step ? "No variables in scope yet." : "Nothing was recorded."}</p>
            ) : (
              vars.map(([name, id]) => (
                <ValueRow key={name} name={name} value={trace.values[id]} changed={prev !== undefined && prev.vars[name] !== id} />
              ))
            )}
          </Section>
          {state && <StateView state={state} prev={prevState} />}
          <Section title="Console" testId="debug-console">
            {trace.logs.length === 0 ? (
              <p className="text-outline font-body-sm text-body-sm">Nothing logged.</p>
            ) : (
              trace.logs.map((l, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => go(l.step)}
                  title={`Logged at line ${steps[l.step]?.line ?? "?"} — click to go there`}
                  className={`flex items-start gap-space-xs text-left rounded px-1 py-0.5 hover:bg-surface-container-high ${LEVEL_TONE[l.level]} ${
                    l.step > at ? "opacity-40" : ""
                  } ${l.step === at ? "bg-primary/10" : ""}`}
                >
                  <span className="w-8 shrink-0 font-label-sm text-label-sm text-outline">L{steps[l.step]?.line ?? "?"}</span>
                  <span className="flex-1 whitespace-pre-wrap break-all font-code-block text-code-block">{l.message}</span>
                </button>
              ))
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function ToolButton({ icon, label, title, onClick, disabled, primary }: { icon: string; label: string; title: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-0.5 pl-1 pr-space-xs py-0.5 rounded font-label-sm text-label-sm disabled:opacity-40 disabled:cursor-not-allowed ${
        primary ? "bg-primary text-on-primary hover:bg-primary/90" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
      }`}
    >
      <Icon name={icon} className="text-body-md" />
      {label}
    </button>
  );
}

function Notice({ tone, children }: { tone: "warn"; children: ReactNode }) {
  return (
    <p className={`mx-space-sm mt-space-xs px-space-xs py-1 rounded font-body-sm text-body-sm ${tone === "warn" ? "bg-tertiary-container/25 text-on-surface" : ""}`}>
      {children}
    </p>
  );
}

function Section({ title, testId, children }: { title: string; testId?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-0.5" data-testid={testId}>
      <h4 className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{title}</h4>
      {children}
    </section>
  );
}

/** What the script's rq calls had done by this step, with what changed on it marked. */
function StateView({ state, prev }: { state: DebugState; prev?: DebugState }) {
  const groups: { title: string; key: keyof DebugState; hint: string }[] = [
    { title: "rq.environment changes", key: "environment", hint: "saved to the environment after the run" },
    { title: "rq.user changes", key: "user", hint: "saved to the test user after the run" },
    { title: "rq.variables", key: "variables", hint: "{{vars.*}}" },
  ];
  const shown = groups.filter((g) => Object.keys((state[g.key] as Record<string, unknown> | undefined) ?? {}).length > 0);
  return (
    <Section title="rq" testId="debug-rq">
      {shown.length === 0 && state.request === undefined && <p className="text-outline font-body-sm text-body-sm">No rq changes yet.</p>}
      {shown.map((g) => {
        const now = (state[g.key] ?? {}) as Record<string, unknown>;
        const before = ((prev?.[g.key] ?? {}) as Record<string, unknown>) ?? {};
        return (
          <div key={g.key} className="flex flex-col">
            <span className="font-label-sm text-label-sm text-on-surface-variant" title={g.hint}>
              {g.title}
            </span>
            {Object.entries(now).map(([name, v]) => (
              <ValueRow
                key={name}
                name={name}
                value={v === null && g.key !== "variables" ? { t: "undefined" } : fromJson(v)}
                note={v === null && g.key !== "variables" ? "unset" : undefined}
                changed={prev !== undefined && JSON.stringify(before[name]) !== JSON.stringify(v)}
              />
            ))}
          </div>
        );
      })}
      {state.request !== undefined && (
        <ValueRow name="rq.request" value={fromJson(state.request)} changed={prev !== undefined && JSON.stringify(prev.request) !== JSON.stringify(state.request)} />
      )}
    </Section>
  );
}

/** Plain JSON (rq state) as a recorded value. */
function fromJson(v: unknown): DebugValue {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return { t: "array", length: v.length, items: v.map(fromJson) };
  if (typeof v === "object") return { t: "object", entries: Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, fromJson(x)]) };
  return { t: "undefined" };
}

function children(v: DebugValue): [string, DebugValue][] | null {
  if (v === null || typeof v !== "object") return null;
  if (v.t === "object") return v.entries.length || v.more ? v.entries : null;
  if (v.t === "array") return v.items.length ? v.items.map((x, i) => [String(i), x]) : null;
  return null;
}

function preview(v: DebugValue, top = true): { text: string; tone: string } {
  if (v === null) return { text: "null", tone: "text-outline" };
  if (typeof v === "string") return { text: JSON.stringify(v.length > 200 && !top ? `${v.slice(0, 200)}…` : v), tone: "text-tertiary" };
  if (typeof v === "number" || typeof v === "boolean") return { text: String(v), tone: "text-secondary" };
  switch (v.t) {
    case "undefined":
      return { text: "undefined", tone: "text-outline" };
    case "number":
    case "bigint":
      return { text: v.t === "bigint" ? `${v.v}n` : v.v, tone: "text-secondary" };
    case "symbol":
      return { text: v.v, tone: "text-secondary" };
    case "string":
      return { text: `${JSON.stringify(v.v)}… (${v.length} characters)`, tone: "text-tertiary" };
    case "function":
      return { text: `ƒ ${v.name || "anonymous"}()`, tone: "text-primary" };
    case "date":
      return { text: `Date ${v.v}`, tone: "text-on-surface" };
    case "error":
      return { text: `${v.name}: ${v.message}`, tone: "text-error" };
    case "circular":
      return { text: "[circular]", tone: "text-outline" };
    case "getter":
      return { text: "(getter)", tone: "text-outline" };
    case "more":
      return { text: v.kind === "array" ? `[…${v.size ?? ""}]` : "{…}", tone: "text-outline" };
    case "array": {
      const inner = top ? v.items.slice(0, 5).map((x) => preview(x, false).text).join(", ") : "…";
      return { text: `${v.cls ?? ""}(${v.length}) [${inner}${v.length > 5 && top ? ", …" : ""}]`, tone: "text-on-surface" };
    }
    case "object": {
      const keys = v.entries.slice(0, 4).map(([k]) => k);
      const more = v.entries.length > 4 || v.more;
      return { text: `${v.cls ? `${v.cls} ` : ""}{${top ? `${keys.join(", ")}${more ? ", …" : ""}` : "…"}}`, tone: "text-on-surface" };
    }
  }
}

function ValueRow({ name, value, changed = false, note, depth = 0 }: { name: string; value: DebugValue; changed?: boolean; note?: string; depth?: number }) {
  const [open, setOpen] = useState(false);
  const kids = children(value);
  const { text, tone } = preview(value);
  const more = value !== null && typeof value === "object" && value.t === "object" ? value.more : undefined;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => kids && setOpen((o) => !o)}
        className={`flex items-start gap-1 text-left rounded px-0.5 font-code-block text-code-block min-w-0 ${kids ? "hover:bg-surface-container-high" : "cursor-default"} ${
          changed ? "bg-tertiary-container/30" : ""
        }`}
        style={{ paddingLeft: `${depth * 12 + 2}px` }}
        aria-expanded={kids ? open : undefined}
        title={changed ? "Changed on this step" : undefined}
      >
        <Icon name={kids ? (open ? "expand_more" : "chevron_right") : "remove"} className={`text-body-sm shrink-0 ${kids ? "text-outline" : "opacity-0"}`} />
        <span className="text-primary shrink-0">{name}:</span>
        <span className={`${tone} break-all ${open ? "" : "line-clamp-2"}`}>{text}</span>
        {note && <span className="text-outline italic shrink-0">{note}</span>}
      </button>
      {open &&
        kids?.map(([k, v]) => <ValueRow key={k} name={k} value={v} depth={depth + 1} />)}
      {open && more ? <span className="text-outline font-body-sm text-body-sm" style={{ paddingLeft: `${(depth + 1) * 12 + 18}px` }}>… {more} more</span> : null}
    </div>
  );
}

/** Read-only code with breakpoints (shared with the script's editor) and the current / error line. */
function CodeView({ code, current, error, storeKey }: { code: string; current: number | null; error: number | null; storeKey: string | null }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const [breakpoints] = useBreakpoints(storeKey);
  const latest = useRef({ breakpoints, storeKey });
  useEffect(() => {
    latest.current = { breakpoints, storeKey };
  });

  useEffect(() => {
    if (!host.current) return;
    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          Prec.highest(
            breakpointGutter((line) => {
              const { breakpoints: lines, storeKey: key } = latest.current;
              if (key) setBreakpoints(key, lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line]);
            }),
          ),
          lineNumbers(),
          javascript(),
          syntaxHighlighting(highlight),
          theme,
          debugHighlights,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ "aria-label": "Debugged script" }),
        ],
      }),
    });
    view.current = editor;
    return () => {
      editor.destroy();
      view.current = null;
    };
  }, [code]);

  useEffect(() => {
    if (view.current) syncBreakpoints(view.current, breakpoints);
  }, [breakpoints, code]);
  useEffect(() => {
    if (view.current) showDebugLines(view.current, current, error);
  }, [current, error, code]);

  return <div ref={host} className="min-h-40 min-w-0 overflow-hidden" data-testid="debug-code" />;
}

/** The debugger in a dialog (flows, Execution History). */
export function ScriptDebuggerDialog({
  title,
  traces,
  keyFor,
  labelFor,
  onClose,
}: {
  title: string;
  traces: ScriptDebug[];
  keyFor?: BreakpointKeyFor;
  labelFor?: LabelFor;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);
  // Portalled to <body>: a panel's backdrop-filter would otherwise confine the fixed overlay to it.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-space-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-6xl h-[80vh] flex flex-col rounded-lg bg-surface-container-lowest border border-outline-variant shadow-2xl overflow-hidden">
        <div className="flex items-center gap-space-xs px-space-sm py-space-xs border-b border-outline-variant/40">
          <Icon name="bug_report" className="text-body-lg text-primary" />
          <h2 className="font-title-sm text-title-sm text-on-surface truncate">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close debugger" className="ml-auto p-1 rounded hover:bg-surface-container-high text-on-surface-variant">
            <Icon name="close" className="text-body-lg" />
          </button>
        </div>
        {traces.length === 0 ? (
          <p className="p-space-md font-body-sm text-body-sm text-on-surface-variant">
            No scripts ran in this run. Debug records Script nodes, “repeat until” scripts and the scripts of linked Collections requests.
          </p>
        ) : (
          <ScriptDebugger traces={traces} keyFor={keyFor} labelFor={labelFor} className="flex-1 min-h-0" />
        )}
      </div>
    </div>,
    document.body,
  );
}
