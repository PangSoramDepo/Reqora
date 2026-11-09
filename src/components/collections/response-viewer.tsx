"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { describeAssertion } from "@/lib/collections/assertions";
import type { AssertionResult, Example, ScriptReport, SendOutcome } from "@/lib/collections/schema";
import { ScopeBadge } from "./inherited";
import { CodeView } from "./json-view";
import { ScriptDebugger } from "./script-debugger";
import { formatBytes, ICON_BUTTON, SELECT, statusTone } from "./ui";

type Tab = "pretty" | "raw" | "headers" | "tests" | "console" | "debugger";

/** One row of the Test Results tab: a script test or a declarative assertion. */
type TestRow = { key: string; passed: boolean; label: string; detail?: string; badge?: { scope: "collection" | "folder" | "request"; source: string } };

const LEVEL_TONE: Record<ScriptReport["logs"][number]["level"], string> = {
  log: "text-on-surface",
  info: "text-secondary",
  warn: "text-tertiary",
  error: "text-error",
};

/** Script logs, errors and variables from a send. */
function ScriptConsole({ scripts, compact = false }: { scripts: ScriptReport | undefined; compact?: boolean }) {
  if (!scripts) {
    return <p className="text-on-surface-variant font-body-sm text-body-sm">No script output — send the request to run its scripts.</p>;
  }
  const vars = Object.entries(scripts.variables);
  const envChanges = Object.entries(scripts.environment ?? {});
  const empty = scripts.logs.length === 0 && scripts.errors.length === 0;
  return (
    <div className="flex flex-col gap-space-sm" data-testid="script-console">
      {scripts.errors.map((e, i) => (
        <div key={`e${i}`} role="alert" className="flex items-start gap-space-xs p-space-xs rounded bg-error-container/30 text-on-error-container">
          <Icon name="error" className="text-body-md text-error" />
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="flex items-center gap-1 font-label-sm text-label-sm">
              <strong>{e.phase === "pre" ? "Pre-request" : "Post-response"} script error</strong>
              <ScopeBadge scope={e.scope} name={e.source} />
              {e.scope !== "request" && <span className="text-outline truncate">{e.source}</span>}
            </span>
            <span className="font-code-block text-code-block break-all">{e.message}</span>
          </div>
        </div>
      ))}
      {scripts.logs.length > 0 && (
        <div className="flex flex-col">
          {scripts.logs.map((l, i) => (
            <div key={`l${i}`} className={`flex items-start gap-space-xs py-0.5 odd:bg-surface-container-low/40 ${LEVEL_TONE[l.level]}`}>
              <span className="w-10 shrink-0 font-label-sm text-label-sm uppercase opacity-70">{l.level}</span>
              <span className="flex-1 whitespace-pre-wrap break-all font-code-block text-code-block">{l.message}</span>
              <span className="shrink-0 flex items-center gap-1" title={l.source}>
                <ScopeBadge scope={l.scope} name={l.source} />
                {l.scope !== "request" && <span className="text-outline font-label-sm text-label-sm max-w-32 truncate">{l.source}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
      {empty && !compact && (
        <p className="text-on-surface-variant font-body-sm text-body-sm">Scripts logged nothing. Use console.log() in a pre-request or post-response script.</p>
      )}
      {envChanges.length > 0 && (
        <div data-testid="env-changes">
          <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-0.5">Environment updated {"{{env.*}}"}</div>
          <table className="font-code-block text-code-block">
            <tbody>
              {envChanges.map(([k, v]) => (
                <tr key={k}>
                  <td className="pr-space-md text-tertiary align-top whitespace-nowrap">{k}</td>
                  <td className={v === null ? "text-outline italic" : "text-on-surface break-all"}>{v === null ? "unset" : v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(!compact || vars.length > 0) && (
        <div>
          <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-0.5">Variables {"{{vars.*}}"}</div>
          {vars.length === 0 ? (
            <p className="text-outline font-body-sm text-body-sm">None set — use rq.variables.set(&quot;name&quot;, value).</p>
          ) : (
            <table className="font-code-block text-code-block">
              <tbody>
                {vars.map(([k, v]) => (
                  <tr key={k}>
                    <td className="pr-space-md text-tertiary align-top whitespace-nowrap">{k}</td>
                    <td className="text-on-surface break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

/** What the viewer shows: the live result of the last send, or a saved example. */
type View = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: unknown;
  size: number;
  durationMs: number;
  assertions?: AssertionResult[];
  url?: string;
};

type Props = {
  outcome: SendOutcome | null;
  sending: boolean;
  examples: Example[];
  onSaveExample: () => void;
  onDeleteExample: (id: string) => void;
  canSaveExample: boolean;
};

function contentType(headers: Record<string, string>) {
  return Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1];
}

function texts(view: View) {
  const isJson = typeof view.body !== "string";
  return {
    isJson,
    pretty: isJson ? JSON.stringify(view.body, null, 2) : (view.body as string),
    raw: isJson ? JSON.stringify(view.body) : (view.body as string),
  };
}

export function ResponseViewer({ outcome, sending, examples, onSaveExample, onDeleteExample, canSaveExample }: Props) {
  const [tab, setTab] = useState<Tab>("pretty");
  const [exampleId, setExampleId] = useState("");
  const [copied, setCopied] = useState(false);

  const example = examples.find((e) => e.id === exampleId);
  const live = outcome && "status" in outcome ? outcome : null;
  const view: View | null = example ? { ...example.response } : live;
  const failure = !example && outcome && "error" in outcome ? outcome : null;
  const t = view ? texts(view) : null;
  const scripts = example ? undefined : (live?.scripts ?? failure?.scripts);
  const results: TestRow[] = [
    ...(scripts?.tests ?? []).map((t, i) => ({
      key: `s${i}`,
      passed: t.passed,
      label: t.name,
      detail: t.error,
      badge: { scope: t.scope, source: t.source },
    })),
    ...(view?.assertions ?? []).map((r, i) => ({ key: `a${i}`, passed: r.passed, label: describeAssertion(r.assertion), detail: r.actual })),
  ];
  const passed = results.filter((r) => r.passed).length;
  const traces = scripts?.debug;
  // A Debug send opens the debugger; a normal send leaves it.
  const [seen, setSeen] = useState(outcome);
  const [sends, setSends] = useState(0);
  if (seen !== outcome) {
    setSeen(outcome);
    setSends((n) => n + 1);
    if (traces) setTab("debugger");
    else if (tab === "debugger") setTab("pretty");
  }
  const consoleCount = scripts ? scripts.logs.length + scripts.errors.length : 0;

  const copy = () => {
    if (!t) return;
    void navigator.clipboard
      .writeText(tab === "raw" ? t.raw : t.pretty)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => undefined);
  };
  const download = () => {
    if (!view || !t) return;
    const blob = new Blob([t.pretty], { type: t.isJson ? "application/json" : "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `response-${view.status}.${t.isJson ? "json" : "txt"}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const tabClass = (id: Tab) =>
    tab === id
      ? "px-space-sm py-1.5 text-primary bg-surface-container-high rounded-t font-semibold flex items-center gap-1"
      : "px-space-sm py-1.5 text-on-surface-variant hover:text-on-surface transition-colors flex items-center gap-1";
  const headerCount = view ? Object.keys(view.headers).length : 0;
  const lines = t ? (tab === "raw" ? t.raw : t.pretty).split("\n").length : 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-surface-container-low shadow-xl">
      {/* Execution Status Bar */}
      <div className="min-h-11 py-1 px-space-sm bg-surface-container flex flex-wrap items-center justify-between gap-space-xs shadow-sm">
        <div className="flex items-center gap-space-md">
          <span className="font-headline-sm text-body-md text-on-surface font-semibold">{example ? "Example" : "Response"}</span>
          {view && (
            <div className="flex items-center gap-space-xs font-label-sm text-label-sm">
              <div className={`flex items-center gap-1 px-2 py-0.5 rounded font-bold shadow-sm ${statusTone(view.status)}`} data-testid="status-pill">
                <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                <span>
                  {view.status} {view.statusText}
                </span>
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                <Icon name="speed" className="text-body-sm text-tertiary" />
                <span>
                  Time: <strong className="text-on-surface font-body-sm">{view.durationMs} ms</strong>
                </span>
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                <Icon name="database" className="text-body-sm text-secondary" />
                <span>
                  Size: <strong className="text-on-surface font-body-sm">{formatBytes(view.size)}</strong>
                </span>
              </div>
            </div>
          )}
          {sending && (
            <span className="flex items-center gap-1 font-label-sm text-label-sm text-on-surface-variant">
              <Icon name="progress_activity" className="text-body-sm animate-spin" /> Sending…
            </span>
          )}
        </div>
        <div className="flex items-center gap-space-xs">
          <div className="relative flex items-center">
            <span className="font-label-sm text-label-sm text-outline mr-1">Example:</span>
            <select
              aria-label="Saved examples"
              className={`${SELECT} pr-6`}
              value={exampleId}
              onChange={(e) => setExampleId(e.target.value)}
            >
              <option value="">{live ? "Live response" : examples.length ? "— none —" : "No saved examples"}</option>
              {examples.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </div>
          {example ? (
            <button
              type="button"
              className={ICON_BUTTON}
              title="Delete this example"
              onClick={() => {
                if (!window.confirm(`Delete example "${example.name}"?`)) return;
                onDeleteExample(example.id);
                setExampleId("");
              }}
            >
              <Icon name="delete" className="text-body-sm" />
            </button>
          ) : (
            <button
              type="button"
              className={`${ICON_BUTTON} flex items-center gap-1 px-2 font-label-sm text-label-sm`}
              title={canSaveExample ? "Save the last response as a named example" : "Send the saved request first"}
              disabled={!live || !canSaveExample}
              onClick={onSaveExample}
            >
              <Icon name="bookmark_add" className="text-body-sm" /> Save as example
            </button>
          )}
          <button type="button" className={ICON_BUTTON} title={copied ? "Copied" : "Copy response body"} disabled={!t} onClick={copy}>
            <Icon name={copied ? "check" : "content_copy"} className="text-body-sm" />
          </button>
          <button type="button" className={ICON_BUTTON} title="Download payload" disabled={!t} onClick={download}>
            <Icon name="download" className="text-body-sm" />
          </button>
        </div>
      </div>

      {/* Response Tabs */}
      <div className="flex items-center justify-between px-space-sm bg-surface-container-lowest/80 text-label-md font-label-md">
        <div className="flex items-center gap-space-xxs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "pretty"} className={tabClass("pretty")} onClick={() => setTab("pretty")}>
            Pretty{t?.isJson ? " (JSON)" : ""}
          </button>
          <button type="button" role="tab" aria-selected={tab === "raw"} className={tabClass("raw")} onClick={() => setTab("raw")}>
            Raw
          </button>
          <button type="button" role="tab" aria-selected={tab === "headers"} className={tabClass("headers")} onClick={() => setTab("headers")}>
            Headers {view && <span className="px-1 rounded bg-surface-container font-label-sm text-label-sm">{headerCount}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === "tests"} className={tabClass("tests")} onClick={() => setTab("tests")}>
            <span>Test Results</span>
            {results.length > 0 && (
              <span
                className={`px-1.5 rounded font-label-sm text-label-sm font-semibold ${
                  passed === results.length ? "bg-primary/20 text-primary" : "bg-error-container/40 text-error"
                }`}
              >
                {passed}/{results.length} Passed
              </span>
            )}
          </button>
          <button type="button" role="tab" aria-selected={tab === "console"} className={tabClass("console")} onClick={() => setTab("console")}>
            <span>Console</span>
            {consoleCount > 0 && (
              <span className={`px-1 rounded font-label-sm text-label-sm ${scripts?.errors.length ? "bg-error-container/40 text-error" : "bg-surface-container"}`}>
                {consoleCount}
              </span>
            )}
          </button>
          {traces && (
            <button type="button" role="tab" aria-selected={tab === "debugger"} className={tabClass("debugger")} onClick={() => setTab("debugger")} data-testid="debugger-tab">
              <Icon name="bug_report" className="text-body-sm" />
              <span>Debugger</span>
              {traces.some((d) => d.error) && <span className="w-1.5 h-1.5 rounded-full bg-error" />}
            </button>
          )}
        </div>
        {view && (
          <div className="hidden md:flex items-center gap-2 py-1 font-label-sm text-label-sm text-outline">
            <span>Lines: {lines}</span>
            {contentType(view.headers) && (
              <>
                <span>•</span>
                <span className="text-primary truncate max-w-64">Content-Type: {contentType(view.headers)}</span>
              </>
            )}
          </div>
        )}
      </div>

      {tab === "debugger" && traces && !example ? (
        <ScriptDebugger key={sends} traces={traces} className="flex-1 bg-surface-container-lowest" />
      ) : (
      /* Body */
      <div className="flex-1 bg-surface-container-lowest overflow-auto p-space-sm font-code-block text-code-block leading-relaxed">
        {!view && !failure && tab !== "console" && (
          <div className="h-full flex flex-col items-center justify-center gap-space-xs text-on-surface-variant font-body-sm text-body-sm">
            <Icon name="send" className="text-headline-lg text-outline" />
            {sending ? "Waiting for the response…" : "Send the request to see the response here."}
          </div>
        )}
        {failure && tab !== "console" && (
          <div className="flex flex-col gap-space-sm">
            <div className="flex items-start gap-space-sm p-space-sm rounded bg-error-container/30 text-on-error-container" role="alert">
              <Icon name="error" className="text-headline-sm text-error" />
              <div className="flex flex-col gap-1">
                <span className="font-headline-sm text-body-md font-semibold">
                  {failure.scripts?.errors.some((e) => e.phase === "pre") ? "Pre-request script failed — request not sent" : "No response received"}
                </span>
                <span className="font-code-block text-code-block break-all">{failure.error}</span>
                {failure.url && <span className="font-code-block text-code-block text-outline break-all">{failure.url}</span>}
              </div>
            </div>
            {failure.scripts &&
              (failure.scripts.logs.length > 0 || failure.scripts.errors.length > 0 || Object.keys(failure.scripts.variables).length > 0 || Object.keys(failure.scripts.environment ?? {}).length > 0) && (
                <ScriptConsole scripts={failure.scripts} compact />
              )}
          </div>
        )}
        {tab === "console" &&
          (example ? (
            <p className="text-outline font-body-sm text-body-sm">Saved examples don&apos;t store script output.</p>
          ) : (
            <ScriptConsole scripts={scripts} />
          ))}
        {view && t && tab === "pretty" && <CodeView text={t.pretty} json={t.isJson} />}
        {view && t && tab === "raw" && <pre className="whitespace-pre-wrap break-all text-on-surface">{t.raw}</pre>}
        {view && tab === "headers" && (
          <table className="w-full font-code-block text-code-block">
            <tbody>
              {Object.entries(view.headers).map(([k, v]) => (
                <tr key={k} className="odd:bg-surface-container-low/40">
                  <td className="py-0.5 pr-space-md text-primary align-top whitespace-nowrap">{k}</td>
                  <td className="py-0.5 text-on-surface break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {view && tab === "tests" && (
          <div className="flex flex-col gap-1">
            {example && <p className="text-outline font-body-sm text-body-sm">Saved examples don&apos;t store test results.</p>}
            {!example && results.length === 0 && (
              <p className="text-on-surface-variant font-body-sm text-body-sm">No tests defined — add assertions in the Tests tab, or rq.test() calls in a post-response script.</p>
            )}
            {results.map((r) => (
              <div key={r.key} className={`flex items-center gap-space-xs min-w-0 ${r.passed ? "text-primary" : "text-error"}`} data-testid="test-row">
                <Icon name={r.passed ? "check_circle" : "cancel"} className="text-body-md" />
                {r.badge ? (
                  <span className="flex items-center gap-1 shrink-0" title={r.badge.scope === "request" ? "Script test from this request" : `Script test from ${r.badge.scope} “${r.badge.source}”`}>
                    <ScopeBadge scope={r.badge.scope} />
                    {r.badge.scope !== "request" && <span className="text-outline font-label-sm text-label-sm max-w-32 truncate">{r.badge.source}</span>}
                  </span>
                ) : (
                  <span className="px-1 rounded font-label-sm text-label-sm bg-secondary-container/30 text-secondary shrink-0" title="Declarative test (Tests tab)">
                    assertion
                  </span>
                )}
                <span className="truncate">{r.label}</span>
                {r.detail !== undefined && <span className="text-outline truncate">— {r.badge ? r.detail : `actual: ${r.detail}`}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Bottom Assertion Bar */}
      {results.length > 0 && (
        <div className="px-space-sm py-1 bg-surface-container-high/80 flex items-center justify-between gap-space-sm text-label-sm font-label-sm">
          <div className="flex items-center gap-space-sm min-w-0 overflow-hidden">
            <span className={`whitespace-nowrap font-semibold ${passed === results.length ? "text-primary" : "text-error"}`} data-testid="tests-summary">
              {passed}/{results.length} passed
            </span>
            {results.slice(0, 3).map((r) => (
              <span key={r.key} className={`flex items-center gap-1 whitespace-nowrap ${r.passed ? "text-primary" : "text-error"}`}>
                <Icon name={r.passed ? "check_circle" : "cancel"} className="text-body-sm" />
                {r.label}
                {!r.badge && r.detail !== undefined && (r.detail.startsWith("(") ? ` ${r.detail}` : ` (${r.detail})`)}
              </span>
            ))}
            {results.length > 3 && <span className="text-outline whitespace-nowrap">+{results.length - 3} more</span>}
          </div>
          <button
            type="button"
            onClick={() => setTab("tests")}
            className="flex items-center gap-1 text-on-surface-variant hover:text-on-surface whitespace-nowrap"
          >
            <span>View Test Results</span>
            <Icon name="chevron_right" className="text-body-sm" />
          </button>
        </div>
      )}
    </div>
  );
}
