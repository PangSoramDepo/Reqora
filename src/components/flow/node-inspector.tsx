"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { NumberField } from "@/components/number-field";
import { fetchRequest, requestToNodeDraft } from "@/lib/collections/client";
import type { SavedRequest } from "@/lib/collections/schema";
import { ApiError } from "@/lib/workflows/client";
import type { Step, WorkflowNode } from "@/lib/workflows/schema";
import { LinkedRequestEditor } from "./linked-request-editor";
import { NodeConfigForm } from "./node-config-form";
import { NodeDocs } from "./node-docs";
import { RepeatChecks, ScriptLogs } from "./repeat-checks";
import { RepeatUntilEditor } from "./repeat-until-editor";

type HttpNode = Extract<WorkflowNode, { type: "http" }>;

const TABS = ["Headers", "Body (JSON)", "Outputs", "Settings"] as const;
type Tab = (typeof TABS)[number];

const SECTION_LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const CODE_BLOCK =
  "p-space-sm rounded-lg bg-surface-container-lowest font-mono text-[11px] shadow-inner overflow-auto whitespace-pre";
const ICON_BUTTON =
  "p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors";
const ROW = "flex items-center gap-space-xs p-space-xs rounded bg-surface-container-lowest font-mono text-body-sm";

type InspectorProps = {
  node: WorkflowNode;
  step?: Step;
  running: boolean;
  onChange: (node: WorkflowNode) => void;
  onRun: () => void;
  /** Pinned: the inspector stays on this node while other nodes are selected. */
  pinned: boolean;
  onTogglePin: () => void;
};

function curlFor(node: HttpNode) {
  const headers = Object.entries(node.config.headers).map(([k, v]) => ` -H '${k}: ${v}'`);
  const body = node.config.body ? ` --data '${node.config.body.replace(/\s*\n\s*/g, " ")}'` : "";
  return `curl -X ${node.config.method} '${node.config.url}'${headers.join("")}${body}`;
}

type LinkState = { requestId: string; name?: string; missing?: boolean };

/**
 * A node dropped from Collections stays linked to its saved request: runs rebuild it from that request, so its
 * fields are read-only here. Unlinking keeps the current copy as an ordinary, editable node.
 */
function LinkedRequestBanner({ node, onChange, onEdit, savedName }: { node: HttpNode; onChange: (n: WorkflowNode) => void; onEdit: () => void; savedName?: string }) {
  const requestId = node.config.requestId!;
  const [link, setLink] = useState<LinkState>({ requestId });

  useEffect(() => {
    let cancelled = false;
    fetchRequest(requestId)
      .then((saved) => !cancelled && setLink({ requestId, name: saved.name }))
      .catch((error: unknown) => {
        if (!cancelled && error instanceof ApiError && error.status === 404) setLink({ requestId, missing: true });
      });
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  const current = link.requestId === requestId ? link : { requestId };
  const unlink = () => {
    const { requestId: _drop, ...config } = node.config;
    void _drop;
    onChange({ ...node, config });
  };

  return (
    <div
      data-testid="linked-request"
      className={`flex flex-col gap-space-xs p-space-sm rounded-lg ${
        current.missing ? "bg-error-container/40 text-on-error-container" : "bg-surface-container-lowest"
      }`}
    >
      <div className="flex items-center gap-space-xs min-w-0">
        <Icon name={current.missing ? "link_off" : "link"} className={`text-body-md ${current.missing ? "" : "text-primary"}`} />
        <span className="font-body-sm text-body-sm text-on-surface truncate flex-1">
          {current.missing ? (
            "The linked Collections request was deleted"
          ) : (
            <>
              Linked to <span className="font-semibold">“{savedName ?? current.name ?? "…"}”</span>
            </>
          )}
        </span>
        {!current.missing && (
          <button
            type="button"
            data-testid="edit-linked-request"
            className="flex items-center gap-1 px-space-xs py-0.5 rounded bg-primary/15 text-primary hover:bg-primary/25 font-label-sm text-label-sm shrink-0"
            title="Edit the request here: params, auth, headers, body, scripts and tests"
            onClick={onEdit}
          >
            <Icon name="edit" className="text-body-sm" /> Edit request
          </button>
        )}
        <button
          className="font-label-sm text-label-sm text-on-surface-variant hover:text-on-surface hover:underline shrink-0"
          title="Keep this copy as a normal node you can edit here; Collections edits will no longer apply"
          type="button"
          onClick={unlink}
        >
          Unlink
        </button>
      </div>
      <span className="font-label-sm text-label-sm text-outline">
        {current.missing
          ? "Runs of this node fail until you unlink it, which keeps the copy below."
          : "Each run sends this request exactly like Send in Collections: inherited auth and headers, pre-request and post-response scripts, and tests (a failed test fails the step). rq.variables carry over to later linked nodes. Edit request changes it everywhere it's used; Unlink to edit a separate copy here instead."}
      </span>
    </div>
  );
}

/** Read-only fields of a linked node: a click opens the request editor. */
function EditHint({ onEdit }: { onEdit: () => void }) {
  return (
    <button type="button" className="self-start font-label-sm text-label-sm text-primary hover:underline flex items-center gap-1" onClick={onEdit}>
      <Icon name="edit" className="text-body-sm" /> Read-only copy of the linked request — edit it
    </button>
  );
}

function HttpPanels({ node, tab, onChange, onEdit }: { node: HttpNode; tab: Tab; onChange: (n: WorkflowNode) => void; onEdit: () => void }) {
  const update = (config: Partial<HttpNode["config"]>) => onChange({ ...node, config: { ...node.config, ...config } });
  const linked = !!node.config.requestId;

  switch (tab) {
    case "Headers":
      return (
        <div className="flex flex-col gap-space-xs">
          <span className={SECTION_LABEL}>Request Headers</span>
          {linked && <EditHint onEdit={onEdit} />}
          <div className="flex flex-col gap-space-xxs">
            {Object.entries(node.config.headers).length === 0 && (
              <span className="font-body-sm text-body-sm text-outline">No headers.</span>
            )}
            {Object.entries(node.config.headers).map(([name, value]) => (
              <div key={name} className={ROW}>
                <span className="text-on-surface-variant w-28 truncate">{name}</span>
                <span className="text-outline">:</span>
                <span className={`${value.includes("{{env.") ? "text-tertiary" : "text-on-surface"} flex-1 truncate`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    case "Body (JSON)":
      return (
        <div className="flex flex-col gap-space-xs">
          <label className={SECTION_LABEL} htmlFor="node-body">
            Payload Interpolation
          </label>
          {linked && <EditHint onEdit={onEdit} />}
          <textarea
            id="node-body"
            className={`${CODE_BLOCK} leading-relaxed text-on-surface min-h-36 resize-y focus:outline-none focus:ring-1 focus:ring-primary/40 ${linked ? "cursor-pointer" : ""}`}
            spellCheck={false}
            readOnly={linked}
            onClick={linked ? onEdit : undefined}
            value={node.config.body ?? ""}
            placeholder={'{ "id": "{{node-1.body.id}}" }'}
            onChange={(e) => update({ body: e.target.value === "" ? undefined : e.target.value })}
          />
          <span className="font-body-sm text-body-sm text-outline">
            Use <span className="text-tertiary font-mono">{"{{node-id.body.field}}"}</span>,{" "}
            <span className="text-tertiary font-mono">{"{{trigger.body.field}}"}</span> or{" "}
            <span className="text-tertiary font-mono">{"{{env.NAME}}"}</span>.
          </span>
        </div>
      );
    case "Outputs":
      return (
        <div className="flex flex-col gap-space-xs">
          <span className={SECTION_LABEL}>Reference In Later Nodes</span>
          {["status", "body", "headers", "durationMs"].map((field) => (
            <div key={field} className={ROW}>
              <span className="w-2 h-2 rounded-full bg-primary" />
              <span className="text-primary flex-1">{`{{${node.id}.${field}}}`}</span>
            </div>
          ))}
        </div>
      );
    case "Settings":
      return (
        <div className="flex flex-col gap-space-xs">
          <label className={SECTION_LABEL} htmlFor="node-timeout">
            Timeout (ms)
          </label>
          <NumberField
            id="node-timeout"
            label="Timeout (ms)"
            className={`${ROW} text-on-surface focus:outline-none`}
            min={100}
            max={30000}
            step={100}
            integer
            readOnly={linked}
            value={node.config.timeoutMs}
            onCommit={(timeoutMs) => update({ timeoutMs })}
          />
          {linked && <EditHint onEdit={onEdit} />}
          <span className="font-body-sm text-body-sm text-outline">Responses with status ≥ 400 fail the run.</span>
        </div>
      );
  }
}

export function NodeInspector({ node, step, running, onChange, onRun, pinned, onTogglePin }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("Headers");
  const [showDocs, setShowDocs] = useState(false);
  const [copied, setCopied] = useState(false);
  // The linked request open in the editor dialog, and its name after the last save there.
  const [editing, setEditing] = useState<string | null>(null);
  const [savedName, setSavedName] = useState<{ requestId: string; name: string } | null>(null);
  const linkedId = node.type === "http" ? node.config.requestId : undefined;
  const editLinked = () => linkedId && setEditing(linkedId);

  /** After a save in the editor, refresh the node's copy (method, URL, headers, body) from the saved request. */
  const refreshLinked = (saved: SavedRequest) => {
    setSavedName({ requestId: saved.id, name: saved.name });
    requestToNodeDraft({ requestId: saved.id })
      .then((draft) => {
        if (node.type !== "http" || node.config.requestId !== saved.id) return;
        onChange({ ...node, config: { ...draft.config, ...(node.config.repeat ? { repeat: node.config.repeat } : {}) } });
      })
      .catch(() => {}); // The run rebuilds the node from the saved request anyway.
  };

  const copyCurl = async () => {
    if (node.type !== "http") return;
    await navigator.clipboard.writeText(curlFor(node));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const response = step?.output as { status?: number } | undefined;

  return (
    <aside className="w-[380px] h-full bg-surface-container-low/95 backdrop-blur-xl z-30 flex flex-col shadow-2xl overflow-y-auto">
      <div className="h-14 shrink-0 px-space-md flex items-center justify-between bg-surface-container-lowest/70">
        <div className="flex items-center gap-space-xs min-w-0">
          <Icon name="tune" className="text-primary text-headline-sm" />
          <div className="flex flex-col min-w-0">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold leading-tight">
              Node Inspector
            </span>
            <span className="font-label-sm text-label-sm text-outline truncate">
              {node.type.toUpperCase()} #{node.id} ({node.name})
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {node.type !== "webhook" && (
            <button
              className={`flex items-center gap-1 px-space-xs py-1 rounded font-label-md text-label-md ${
                node.disabled
                  ? "bg-primary/15 text-primary hover:bg-primary/25"
                  : "bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
              }`}
              title={node.disabled ? "Enable this node (D)" : "Disable this node: runs skip it and continue to the next nodes (D)"}
              type="button"
              onClick={() => onChange({ ...node, disabled: !node.disabled || undefined })}
            >
              <Icon name={node.disabled ? "play_circle" : "block"} className="text-body-sm" />
              {node.disabled ? "Enable" : "Disable"}
            </button>
          )}
          <button
            className={`${ICON_BUTTON} ${showDocs ? "text-primary bg-surface-container" : ""}`}
            title={showDocs ? "Hide node documentation" : "Node documentation: what this node does, its outputs and tips"}
            aria-pressed={showDocs}
            type="button"
            onClick={() => setShowDocs((v) => !v)}
          >
            <Icon name="help_outline" className="text-body-md" />
          </button>
          <button
            className={`${ICON_BUTTON} ${pinned ? "text-primary bg-surface-container" : ""}`}
            title={pinned ? "Unpin: follow the selected node again" : "Pin: keep showing this node while you select others"}
            aria-pressed={pinned}
            type="button"
            onClick={onTogglePin}
          >
            <Icon name="push_pin" className="text-body-md" style={pinned ? { fontVariationSettings: "'FILL' 1" } : undefined} />
          </button>
        </div>
      </div>

      <div className="p-space-md flex flex-col gap-space-md flex-1">
        {showDocs && <NodeDocs type={node.type} nodeId={node.id} />}
        {node.disabled && (
          <div
            data-testid="node-disabled"
            className="flex items-start gap-space-xs p-space-sm rounded-lg bg-surface-container-highest/70 font-body-sm text-body-sm text-on-surface-variant"
          >
            <Icon name="block" className="text-body-md text-outline mt-0.5" />
            <span>
              <span className="text-on-surface font-semibold">Disabled.</span> Runs skip this node and continue through it to the next
              nodes{node.type === "condition" ? " — both the TRUE and FALSE branches" : ""}. Later nodes that reference{" "}
              <span className="font-mono text-tertiary">{`{{${node.id}.…}}`}</span> will fail, since it has no output.
            </span>
          </div>
        )}
        <div className="flex flex-col gap-space-xs">
          <label className={SECTION_LABEL} htmlFor="node-name">
            Name
          </label>
          <input
            id="node-name"
            className={`${ROW} text-on-surface focus:outline-none`}
            value={node.name}
            maxLength={120}
            onChange={(e) => onChange({ ...node, name: e.target.value || node.name })}
          />
        </div>

        {node.type === "http" ? (
          <>
            {node.config.requestId && (
              <LinkedRequestBanner
                node={node}
                onChange={onChange}
                onEdit={editLinked}
                savedName={savedName?.requestId === node.config.requestId ? savedName.name : undefined}
              />
            )}
            <div className="flex flex-col gap-space-xs">
              <label className={SECTION_LABEL} htmlFor="request-target">
                Request Target
              </label>
              <div className="flex items-center rounded-lg bg-surface-container-lowest overflow-hidden shadow-inner">
                <select
                  aria-label="HTTP method"
                  className="px-space-sm py-space-xs bg-primary text-on-primary font-label-sm text-label-sm font-bold uppercase focus:outline-none disabled:opacity-100"
                  disabled={!!node.config.requestId}
                  value={node.config.method}
                  onChange={(e) =>
                    onChange({ ...node, config: { ...node.config, method: e.target.value as HttpNode["config"]["method"] } })
                  }
                >
                  {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <input
                  id="request-target"
                  className={`bg-transparent font-mono text-body-sm text-on-surface px-space-sm py-space-xs w-full focus:outline-none ${node.config.requestId ? "cursor-pointer" : ""}`}
                  type="text"
                  title={node.config.requestId ? "Linked request — click to edit it" : undefined}
                  onClick={node.config.requestId ? editLinked : undefined}
                  readOnly={!!node.config.requestId}
                  value={node.config.url}
                  onChange={(e) => onChange({ ...node, config: { ...node.config, url: e.target.value } })}
                />
              </div>
            </div>

            <div className="flex items-center gap-space-xs rounded bg-surface-container p-0.5" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  className={`flex-1 py-1 text-center font-label-md text-label-md rounded ${
                    tab === t
                      ? "bg-surface-container-highest text-primary font-medium"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                  type="button"
                  onClick={() => setTab(t)}
                >
                  {t === "Headers" ? `Headers (${Object.keys(node.config.headers).length})` : t}
                </button>
              ))}
            </div>

            <HttpPanels node={node} tab={tab} onChange={onChange} onEdit={editLinked} />
            <RepeatUntilEditor node={node} onChange={onChange} />
          </>
        ) : (
          <NodeConfigForm node={node} onChange={onChange} />
        )}

        <div className="flex items-center gap-space-xs">
          <button
            className="flex-1 flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-primary text-on-primary rounded-xl font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-all active:scale-98 shadow-lg disabled:opacity-60"
            type="button"
            disabled={running}
            onClick={onRun}
          >
            <Icon name={running ? "progress_activity" : "play_arrow"} className={`text-body-md ${running ? "animate-spin" : ""}`} />
            <span>{running ? "Running Flow…" : "Run Flow & Inspect"}</span>
          </button>
          {node.type === "http" && (
            <button
              className="p-space-sm bg-surface-container rounded-xl text-on-surface-variant hover:text-on-surface transition-colors"
              title="Copy cURL (templates unresolved)"
              type="button"
              onClick={copyCurl}
            >
              <Icon name={copied ? "check" : "content_copy"} className="text-body-md" />
            </button>
          )}
        </div>

        <div className="flex flex-col gap-space-xs mt-space-xs">
          <div className="flex items-center justify-between">
            <span className={SECTION_LABEL}>Last Run Output</span>
            {step && (
              <div className="flex items-center gap-space-xxs">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    step.status === "failed" ? "bg-error" : step.status === "skipped" ? "bg-outline" : "bg-primary"
                  }`}
                />
                <span
                  className={`font-label-sm text-label-sm font-bold ${
                    step.status === "failed" ? "text-error" : step.status === "skipped" ? "text-outline" : "text-primary"
                  }`}
                >
                  {step.disabled ? "DISABLED" : step.status.toUpperCase()}
                  {response?.status !== undefined && ` • ${response.status}`}
                  {step.status !== "skipped" && ` • ${step.durationMs}ms`}
                </span>
              </div>
            )}
          </div>
          {step?.error && (
            <div className="p-space-xs rounded bg-error-container/40 text-on-error-container font-mono text-body-sm">
              {step.error}
            </div>
          )}
          {step?.checks && step.checks.length > 0 && <RepeatChecks checks={step.checks} attempts={step.attempts} />}
          {step?.logs && step.logs.length > 0 && <ScriptLogs logs={step.logs} />}
          <div className={`${CODE_BLOCK} leading-snug text-on-surface-variant max-h-56`}>
            {step?.output !== undefined
              ? JSON.stringify(step.output, null, 2)
              : step
                ? step.disabled
                  ? "// Node was disabled in the last run; the run passed through it"
                  : "// Node was skipped in the last run"
                : "// Run the flow to see this node's output"}
          </div>
        </div>
      </div>
      {editing && editing === linkedId && <LinkedRequestEditor requestId={editing} onClose={() => setEditing(null)} onSaved={refreshLinked} />}
    </aside>
  );
}
