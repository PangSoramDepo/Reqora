"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { describeAssertion } from "@/lib/collections/assertions";
import type { AssertionResult, Example, SendOutcome } from "@/lib/collections/schema";
import { CodeView } from "./json-view";
import { formatBytes, ICON_BUTTON, SELECT, statusTone } from "./ui";

type Tab = "pretty" | "raw" | "headers" | "tests";

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
  const results = view?.assertions ?? [];
  const passed = results.filter((r) => r.passed).length;

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

      {/* Body */}
      <div className="flex-1 bg-surface-container-lowest overflow-auto p-space-sm font-code-block text-code-block leading-relaxed">
        {!view && !failure && (
          <div className="h-full flex flex-col items-center justify-center gap-space-xs text-on-surface-variant font-body-sm text-body-sm">
            <Icon name="send" className="text-headline-lg text-outline" />
            {sending ? "Waiting for the response…" : "Send the request to see the response here."}
          </div>
        )}
        {failure && (
          <div className="flex items-start gap-space-sm p-space-sm rounded bg-error-container/30 text-on-error-container" role="alert">
            <Icon name="error" className="text-headline-sm text-error" />
            <div className="flex flex-col gap-1">
              <span className="font-headline-sm text-body-md font-semibold">No response received</span>
              <span className="font-code-block text-code-block break-all">{failure.error}</span>
              {failure.url && <span className="font-code-block text-code-block text-outline break-all">{failure.url}</span>}
            </div>
          </div>
        )}
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
              <p className="text-on-surface-variant font-body-sm text-body-sm">No tests defined — add some in the Tests tab above.</p>
            )}
            {results.map((r, i) => (
              <div key={i} className={`flex items-center gap-space-xs ${r.passed ? "text-primary" : "text-error"}`}>
                <Icon name={r.passed ? "check_circle" : "cancel"} className="text-body-md" />
                <span>{describeAssertion(r.assertion)}</span>
                {r.actual !== undefined && <span className="text-outline truncate">— actual: {r.actual}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom Assertion Bar */}
      {results.length > 0 && (
        <div className="px-space-sm py-1 bg-surface-container-high/80 flex items-center justify-between gap-space-sm text-label-sm font-label-sm">
          <div className="flex items-center gap-space-sm min-w-0 overflow-hidden">
            {results.slice(0, 3).map((r, i) => (
              <span key={i} className={`flex items-center gap-1 whitespace-nowrap ${r.passed ? "text-primary" : "text-error"}`}>
                <Icon name={r.passed ? "check_circle" : "cancel"} className="text-body-sm" />
                {describeAssertion(r.assertion)}
                {r.actual !== undefined && (r.actual.startsWith("(") ? ` ${r.actual}` : ` (${r.actual})`)}
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
