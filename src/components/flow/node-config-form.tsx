"use client";

import { useState } from "react";
import { conditionOperators, type WorkflowNode } from "@/lib/workflows/schema";
import { NumberField } from "@/components/number-field";
import { ScriptCodeEditor } from "@/components/collections/script-code-editor";

type NonHttpNode = Exclude<WorkflowNode, { type: "http" }>;

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

/** Edits a transform's output map as JSON; only valid objects of strings are applied. */
function TransformEditor({ node, onChange }: { node: Extract<WorkflowNode, { type: "transform" }>; onChange: (n: WorkflowNode) => void }) {
  const [text, setText] = useState(() => JSON.stringify(node.config.output, null, 2));
  const [error, setError] = useState<string | null>(null);

  const apply = (value: string) => {
    setText(value);
    try {
      const parsed: unknown = JSON.parse(value);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((v) => typeof v !== "string")) {
        throw new Error("must be an object whose values are template strings");
      }
      setError(null);
      onChange({ ...node, config: { output: parsed as Record<string, string> } });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Field label="Output Mapping (JSON)" id="transform-output">
      <textarea id="transform-output" className={AREA} spellCheck={false} value={text} onChange={(e) => apply(e.target.value)} />
      {error ? (
        <span className="font-body-sm text-body-sm text-error">{error} — not saved</span>
      ) : (
        <span className={HINT}>
          Each key becomes <span className="text-tertiary">{`{{${node.id}.key}}`}</span> for later nodes.
        </span>
      )}
    </Field>
  );
}

export function NodeConfigForm({ node, onChange }: { node: NonHttpNode; onChange: (n: WorkflowNode) => void }) {
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
          <span className={HINT}>
            Live endpoint: <span className="text-primary">POST /api/hooks/&lt;workflow-id&gt;</span>. The body is available as{" "}
            <span className="text-tertiary">{"{{trigger.body.*}}"}</span>.
          </span>
        </>
      );

    case "condition":
      return (
        <>
          <Field label="Left Value" id="cond-left">
            <input
              id="cond-left"
              className={FIELD}
              value={node.config.left}
              onChange={(e) => onChange({ ...node, config: { ...node.config, left: e.target.value } })}
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
              <input
                id="cond-right"
                className={FIELD}
                value={node.config.right ?? ""}
                onChange={(e) => onChange({ ...node, config: { ...node.config, right: e.target.value } })}
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
            <textarea
              id="resp-body"
              className={AREA}
              spellCheck={false}
              value={node.config.body ?? ""}
              onChange={(e) =>
                onChange({ ...node, config: { ...node.config, body: e.target.value === "" ? undefined : e.target.value } })
              }
            />
          </Field>
          <span className={HINT}>Returned to the caller of the webhook endpoint.</span>
        </>
      );
  }
}
