"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import type { Scope } from "@/lib/collections/inherit";
import { CodeEditor } from "./code-editor";

export type Phase = "pre" | "post";
type Snippet = { label: string; code: string; phases: Phase[] };

const SNIPPETS: Snippet[] = [
  { label: "Set a variable", code: 'rq.variables.set("orderId", "ord_123");', phases: ["pre"] },
  { label: "Add a header", code: 'rq.request.headers["X-Request-Time"] = new Date().toISOString();', phases: ["pre"] },
  { label: "Read an env value", code: 'const apiKey = rq.environment.get("API_KEY");', phases: ["pre", "post"] },
  { label: "Log the request", code: "console.log(rq.request.method, rq.request.url);", phases: ["pre"] },
  {
    label: "Status code is 200",
    code: 'rq.test("Status code is 200", () => {\n  rq.expect(rq.response.status).toBe(200);\n});',
    phases: ["post"],
  },
  {
    label: "Response time below 200 ms",
    code: 'rq.test("Response time is below 200 ms", () => {\n  rq.expect(rq.response.responseTime).toBeLessThan(200);\n});',
    phases: ["post"],
  },
  {
    label: "JSON value equals",
    code: 'rq.test("ok is true", () => {\n  rq.expect(rq.response.json().ok).toBe(true);\n});',
    phases: ["post"],
  },
  { label: "Save a value from the response", code: 'rq.variables.set("id", String(rq.response.json().id));', phases: ["post"] },
  { label: "Log the response", code: "console.log(rq.response.status, rq.response.json());", phases: ["post"] },
];

const API: Record<Phase, [string, string][]> = {
  pre: [
    ["rq.request", "method, url, params[{key,value}], headers{}, body — editable; templates still unresolved"],
    ["rq.variables", "get / set / unset / toObject — read in templates as {{vars.NAME}}"],
    ["rq.environment.get(\"NAME\")", "environment value (write the name literally)"],
    ["console", "log / info / warn / error → Console tab"],
  ],
  post: [
    ["rq.response", "status, statusText, headers, body, responseTime, json(), text()"],
    ["rq.test(name, fn)", "a named test; throwing fails it"],
    ["rq.expect(v)", "toBe, toEqual, toContain, toBeTruthy, toBeFalsy, toBeGreaterThan, toBeLessThan, toHaveProperty, toMatch"],
    ["rq.variables", "get / set / unset / toObject"],
    ["rq.request", "the request as sent (read-only)"],
    ["console", "log / info / warn / error → Console tab"],
  ],
};

export const PHASE_LABEL: Record<Phase, string> = { pre: "Pre-request Script", post: "Post-response Script" };

export const lineCount = (code: string) => code.trimEnd().split("\n").length;

type Props = {
  phase: Phase;
  value: string;
  onValue: (value: string) => void;
  /** This level's name in the run order ("this request", "this folder"). */
  self: string;
  /** Scripts that run before this one (outer levels), in run order. */
  inherited: { scope: Scope; name: string; code: string }[];
};

/** Code editor for a pre-request / post-response script, with snippets, an API reference and the run order. */
export function ScriptEditor({ phase, value, onValue, self, inherited }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [showApi, setShowApi] = useState(false);

  const insert = (code: string) => {
    const el = box.current?.querySelector("textarea");
    const focused = el && document.activeElement === el;
    const start = focused ? el.selectionStart : value.length;
    const end = focused ? el.selectionEnd : value.length;
    const before = value.slice(0, start);
    const pad = before && !before.endsWith("\n") ? "\n" : "";
    const text = `${pad}${code}\n`;
    onValue(before + text + value.slice(end));
    const caret = start + text.length;
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-space-sm py-1 bg-surface-container-low/70 flex items-center gap-space-xs flex-wrap font-label-sm text-label-sm text-outline shrink-0" data-testid="script-run-order">
        <Icon name="account_tree" className="text-body-sm" />
        <span>Runs:</span>
        {inherited.map((s, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="px-1 rounded bg-surface-container-high text-on-surface-variant" title={s.name}>
              {s.scope} “{s.name}” ({lineCount(s.code)} {lineCount(s.code) === 1 ? "line" : "lines"})
            </span>
            <Icon name="arrow_forward" className="text-body-sm" />
          </span>
        ))}
        <span className="px-1 rounded bg-primary/10 text-primary">{self}</span>
        {inherited.length === 0 && <span>— nothing inherited</span>}
      </div>
      <div className="flex-1 flex min-h-0">
        <div ref={box} className="flex-1 flex min-w-0 min-h-0">
          <CodeEditor
            label={PHASE_LABEL[phase]}
            value={value}
            onValue={onValue}
            placeholder={phase === "pre" ? "// Runs before the request is sent\nrq.variables.set(\"token\", \"abc\");" : "// Runs after the response arrives\nrq.test(\"Status code is 200\", () => rq.expect(rq.response.status).toBe(200));"}
          />
        </div>
        <div className="w-60 shrink-0 overflow-y-auto bg-surface-container-low/50 p-space-xs flex flex-col gap-space-xxs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">{showApi ? "API reference" : "Snippets"}</span>
            <button
              type="button"
              onClick={() => setShowApi((s) => !s)}
              className="font-label-sm text-label-sm text-primary hover:underline"
            >
              {showApi ? "Snippets" : "API reference"}
            </button>
          </div>
          {showApi ? (
            <dl className="flex flex-col gap-1 font-body-sm text-body-sm">
              {API[phase].map(([name, text]) => (
                <div key={name}>
                  <dt className="font-code-block text-code-block text-tertiary">{name}</dt>
                  <dd className="text-on-surface-variant">{text}</dd>
                </div>
              ))}
              <p className="text-outline mt-1">
                Sandboxed: no network or timers, 1 s and 32 MB per script. Collection → folder → request scripts run in order.
              </p>
            </dl>
          ) : (
            SNIPPETS.filter((s) => s.phases.includes(phase)).map((s) => (
              <button
                key={s.label}
                type="button"
                title={s.code}
                // Keep the editor's selection so the snippet lands at its cursor.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insert(s.code)}
                className="text-left px-1.5 py-0.5 rounded hover:bg-surface-container-high text-primary font-body-sm text-body-sm flex items-center gap-1"
              >
                <Icon name="add" className="text-body-sm" /> {s.label}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
