"use client";

import { useState } from "react";
import { conditionOperators, type WorkflowNode } from "@/lib/workflows/schema";
import { NumberField } from "@/components/number-field";
import { ScriptCodeEditor } from "@/components/collections/script-code-editor";
import { Icon } from "@/components/icon";
import { useEnvironment } from "@/lib/environment";
import { webhookCurl, webhookUrl } from "@/lib/workflows/templates";
import { CallFlowEditor } from "./call-flow-editor";
import { TemplateField } from "./template-field";

type NonHttpNode = Exclude<WorkflowNode, { type: "http" }>;

/** The live webhook URL for the environment in the top bar, with copy buttons. */
function WebhookEndpoint({ workflowId }: { workflowId: string }) {
  const environment = useEnvironment();
  const [copied, setCopied] = useState<"url" | "curl" | null>(null);
  const copy = async (what: "url" | "curl") => {
    const origin = window.location.origin;
    const text = what === "url" ? webhookUrl(origin, workflowId, environment) : webhookCurl(origin, workflowId, environment, { example: true });
    await navigator.clipboard.writeText(text).catch(() => undefined);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  return (
    <div className="flex flex-col gap-space-xs" data-testid="webhook-endpoint">
      <span className={LABEL}>Live endpoint ({environment})</span>
      <div className={`${FIELD} break-all text-primary`}>POST /api/hooks/{workflowId}{environment === "production" ? "" : `?environment=${environment}`}</div>
      <div className="flex items-center gap-space-xs">
        {(["url", "curl"] as const).map((what) => (
          <button
            key={what}
            type="button"
            className="flex items-center gap-1 px-space-sm py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-md text-label-md"
            onClick={() => copy(what)}
          >
            <Icon name={copied === what ? "check" : "content_copy"} className="text-body-sm" />
            {copied === what ? "Copied" : what === "url" ? "Copy URL" : "Copy cURL"}
          </button>
        ))}
      </div>
    </div>
  );
}

const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const FIELD =
  "p-space-xs rounded bg-surface-container-lowest font-mono text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40";
const AREA = `${FIELD} min-h-28 resize-y whitespace-pre leading-relaxed`;
const HINT = "font-body-sm text-body-sm text-outline";
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-space-xs">
      <label className={LABEL} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

type TransformNode = Extract<WorkflowNode, { type: "transform" }>;
type MappingRow = { id: number; key: string; value: string };

const toRows = (output: Record<string, string>): MappingRow[] => Object.entries(output).map(([key, value], id) => ({ id, key, value }));
const fromRows = (rows: MappingRow[]) => Object.fromEntries(rows.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]));

/**
 * Edits a transform's output as rows of field name → template value (with suggestions), or as JSON. Rows
 * without a name aren't saved; duplicate names aren't saved until fixed.
 */
function TransformEditor({ node, onChange }: { node: TransformNode; onChange: (n: WorkflowNode) => void }) {
  const [asJson, setAsJson] = useState(false);
  const [rows, setRows] = useState(() => toRows(node.config.output));
  // The output these rows were built from or last saved; a different one (undo, redo) rebuilds the rows.
  const [synced, setSynced] = useState(() => JSON.stringify(node.config.output));
  const [text, setText] = useState(() => JSON.stringify(node.config.output, null, 2));
  const [error, setError] = useState<string | null>(null);

  const current = JSON.stringify(node.config.output);
  if (current !== synced) {
    setSynced(current);
    setRows(toRows(node.config.output));
    setText(JSON.stringify(node.config.output, null, 2));
  }

  const names = rows.map((r) => r.key.trim()).filter(Boolean);
  const duplicate = names.find((n, i) => names.indexOf(n) !== i);

  const commit = (next: MappingRow[]) => {
    setRows(next);
    const keys = next.map((r) => r.key.trim()).filter(Boolean);
    if (keys.some((k, i) => keys.indexOf(k) !== i)) return;
    const output = fromRows(next);
    setSynced(JSON.stringify(output));
    onChange({ ...node, config: { output } });
  };
  const patch = (id: number, change: Partial<MappingRow>) => commit(rows.map((r) => (r.id === id ? { ...r, ...change } : r)));

  const applyJson = (value: string) => {
    setText(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((v) => typeof v !== "string")) {
        throw new Error("must be an object whose values are template strings");
      }
      setError(null);
      setSynced(JSON.stringify(parsed));
      setRows(toRows(parsed as Record<string, string>));
      onChange({ ...node, config: { output: parsed as Record<string, string> } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-space-xs">
      <div className="flex items-center justify-between">
        <span className={LABEL}>Output Mapping</span>
        <button
          type="button"
          className="font-label-sm text-label-sm text-outline hover:text-on-surface"
          onClick={() => {
            setAsJson((v) => !v);
            setText(JSON.stringify(node.config.output, null, 2));
            setError(null);
          }}
        >
          {asJson ? "Edit as fields" : "Edit as JSON"}
        </button>
      </div>
      {asJson ? (
        <>
          <textarea id="transform-output" aria-label="Output mapping JSON" className={AREA} spellCheck={false} value={text} onChange={(e) => applyJson(e.target.value)} />
          {error && <span className="font-body-sm text-body-sm text-error">{error} — not saved</span>}
        </>
      ) : (
        <div className="flex flex-col gap-space-xs" data-testid="mapping-rows">
          {rows.map((row) => (
            <div key={row.id} className="flex items-start gap-space-xxs">
              <input
                aria-label="Field name"
                className={`${FIELD} w-28 shrink-0 text-primary`}
                placeholder="field"
                spellCheck={false}
                value={row.key}
                onChange={(e) => patch(row.id, { key: e.target.value })}
              />
              <TemplateField
                aria-label={`Value of ${row.key || "field"}`}
                mode="value"
                className={`${FIELD} w-full`}
                placeholder="{{trigger.body.id}}"
                value={row.value}
                onChange={(value) => patch(row.id, { value })}
              />
              <button
                type="button"
                className="p-1 mt-0.5 rounded text-outline hover:text-error hover:bg-error-container/20"
                aria-label={`Remove ${row.key || "field"}`}
                onClick={() => commit(rows.filter((r) => r.id !== row.id))}
              >
                <Icon name="close" className="text-body-sm" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="self-start flex items-center gap-1 px-space-xs py-0.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-md text-label-md"
            onClick={() => setRows([...rows, { id: Math.max(-1, ...rows.map((r) => r.id)) + 1, key: "", value: "" }])}
          >
            <Icon name="add" className="text-body-sm" /> Add field
          </button>
          {duplicate && <span className="font-body-sm text-body-sm text-error">“{duplicate}” is used twice — not saved until it&apos;s unique</span>}
        </div>
      )}
      <span className={HINT}>
        Each field becomes <span className="text-tertiary">{`{{${node.id}.field}}`}</span> for later nodes. A value that is exactly one{" "}
        <span className="text-tertiary">{"{{…}}"}</span> keeps its type (numbers, lists).
      </span>
    </div>
  );
}

export function NodeConfigForm({
  node,
  workflowId,
  onChange,
}: {
  node: NonHttpNode;
  /** The flow being edited (a Call Flow node can't call it). */
  workflowId?: string;
  onChange: (n: WorkflowNode) => void;
}) {
  switch (node.type) {
    case "webhook":
      return (
        <>
          <Field label="Method" id="webhook-method">
            <select
              id="webhook-method"
              className={FIELD}
              value={node.config.method}
              onChange={(e) => onChange({ ...node, config: { ...node.config, method: e.target.value as (typeof METHODS)[number] } })}
            >
              {METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </Field>
          <Field label="Path (label)" id="webhook-path">
            <input
              id="webhook-path"
              className={FIELD}
              value={node.config.path}
              onChange={(e) => onChange({ ...node, config: { ...node.config, path: e.target.value } })}
            />
          </Field>
          {workflowId && <WebhookEndpoint workflowId={workflowId} />}
          <span className={HINT}>
            The POSTed JSON is available as <span className="text-tertiary">{"{{trigger.body.*}}"}</span>. The webhook runs the deployed version.
          </span>
        </>
      );

    case "condition":
      return (
        <>
          <Field label="Left Value" id="cond-left">
            <TemplateField
              id="cond-left"
              mode="value"
              className={`${FIELD} w-full`}
              placeholder="{{http-1.body.status}}"
              value={node.config.left}
              onChange={(left) => onChange({ ...node, config: { ...node.config, left } })}
            />
          </Field>
          <Field label="Operator" id="cond-op">
            <select
              id="cond-op"
              className={FIELD}
              value={node.config.operator}
              onChange={(e) =>
                onChange({ ...node, config: { ...node.config, operator: e.target.value as (typeof conditionOperators)[number] } })
              }
            >
              {conditionOperators.map((op) => (
                <option key={op}>{op}</option>
              ))}
            </select>
          </Field>
          {node.config.operator !== "exists" && (
            <Field label="Right Value" id="cond-right">
              <TemplateField
                id="cond-right"
                mode="value"
                className={`${FIELD} w-full`}
                value={node.config.right ?? ""}
                onChange={(right) => onChange({ ...node, config: { ...node.config, right } })}
              />
            </Field>
          )}
          <span className={HINT}>
            The <span className="text-tertiary">TRUE</span> or <span className="text-outline">FALSE</span> port continues; the
            other branch is skipped.
          </span>
        </>
      );

    case "transform":
      return <TransformEditor node={node} onChange={onChange} />;

    case "delay":
      return (
        <Field label="Delay (ms, max 10000)" id="delay-ms">
          <NumberField
            id="delay-ms"
            label="Delay (ms)"
            className={FIELD}
            min={0}
            max={10000}
            step={100}
            integer
            value={node.config.ms}
            onCommit={(ms) => onChange({ ...node, config: { ms } })}
          />
        </Field>
      );

    case "script":
      return (
        <div className="flex flex-col gap-space-xs">
          <span className={LABEL}>Script (JavaScript)</span>
          <div className="h-72 flex flex-col rounded overflow-hidden shadow-inner bg-surface-container-lowest" data-testid="node-script">
            <ScriptCodeEditor
              key={node.id}
              phase="pre"
              label="Script"
              wrap
              value={node.config.code}
              onValue={(code) => onChange({ ...node, config: { code } })}
            />
          </div>
          <span className={HINT}>
            <span className="text-primary font-mono">trigger</span> and <span className="text-primary font-mono">{'nodes["node-id"]'}</span> hold the
            run so far. Use <span className="text-primary font-mono">rq.environment.set</span> / <span className="text-primary font-mono">rq.variables.set</span> to
            pass values on; the returned object becomes <span className="text-tertiary font-mono">{`{{${node.id}.key}}`}</span>. Throw to fail the step.
          </span>
        </div>
      );

    case "call":
      return <CallFlowEditor node={node} workflowId={workflowId} onChange={onChange} />;

    case "response":
      return (
        <>
          <Field label="Status Code" id="resp-status">
            <NumberField
              id="resp-status"
              label="Status Code"
              className={FIELD}
              min={100}
              max={599}
              integer
              value={node.config.status}
              onCommit={(status) => onChange({ ...node, config: { ...node.config, status } })}
            />
          </Field>
          <Field label="Body (JSON template)" id="resp-body">
            <TemplateField
              id="resp-body"
              multiline
              mode="json"
              className={`${AREA} w-full`}
              value={node.config.body ?? ""}
              onChange={(body) => onChange({ ...node, config: { ...node.config, body: body === "" ? undefined : body } })}
            />
          </Field>
          <span className={HINT}>Returned to the caller of the webhook endpoint.</span>
        </>
      );
  }
}
