"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { beautifyJson } from "@/lib/collections/beautify";
import { REQUEST_METHODS, type Collection, type RequestDefinition, type RequestMethod } from "@/lib/collections/schema";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import type { Environment } from "@/lib/workflows/schema";
import { AddToFlow } from "./add-to-flow";
import { AssertionsEditor } from "./assertions-editor";
import { AuthPanel, type InheritSource } from "./auth-panel";
import { CodeEditor } from "./code-editor";
import { inheritanceFor, InheritedHeaders } from "./inherited";
import { KeyValueEditor } from "./key-value-editor";
import { PHASE_LABEL, ScriptEditor } from "./script-editor";
import { TemplateInput, useTokenInsert } from "./template-field";
import { FIELD, GHOST_BUTTON, LABEL, METHOD_SELECT_TONE, SELECT } from "./ui";

export type Draft = { name: string; folderId: string | null; definition: RequestDefinition };
type Tab = "params" | "auth" | "headers" | "body" | "pre" | "post" | "tests" | "settings";

type Props = {
  requestId: string;
  draft: Draft;
  update: (fn: (draft: Draft) => Draft) => void;
  collection: Collection | undefined;
  environment: Environment;
  variableNames: string[];
  dirty: boolean;
  saving: boolean;
  sending: boolean;
  onSave: () => void;
  onSend: () => void;
  /** Opens a collection's or folder's settings (from "inherited from …" links). */
  onOpenScope: (source: InheritSource) => void;
};

const TAB_IDLE = "px-space-sm py-2 text-on-surface-variant hover:text-on-surface font-label-md text-label-md transition-colors flex items-center gap-1.5";
const TAB_ACTIVE = "px-space-sm py-2 text-primary font-label-md text-label-md bg-surface-container-high rounded-t font-semibold flex items-center gap-1.5 shadow-sm";
const COUNT = "px-1 rounded bg-surface-container font-label-sm text-label-sm";

function SuggestedTokens({ names }: { names: string[] }) {
  const insert = useTokenInsert();
  const tokens = [
    ...names.map((n) => ({ token: `{{env.${n}}}`, cls: "bg-tertiary-container/30 hover:bg-tertiary-container/50 text-tertiary" })),
    ...["{{$guid}}", "{{$timestamp}}", "{{$isoTimestamp}}"].map((token) => ({
      token,
      cls: "bg-primary-container/20 hover:bg-primary-container/30 text-primary",
    })),
  ];
  return (
    <div className="px-space-sm py-1 bg-surface-container-low/70 flex items-center gap-space-xs overflow-x-auto shrink-0">
      <span className="font-label-sm text-label-sm text-outline whitespace-nowrap">Suggested Tokens:</span>
      {tokens.map(({ token, cls }) => (
        <button
          key={token}
          type="button"
          title="Insert at cursor"
          // Keep focus in the field being edited so the token lands at its cursor.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert?.(token)}
          className={`px-1.5 py-0.5 rounded font-code-block text-body-sm whitespace-nowrap transition-colors ${cls}`}
        >
          {token}
        </button>
      ))}
      {names.length === 0 && (
        <span className="font-body-sm text-body-sm text-outline whitespace-nowrap">No variables in this environment yet.</span>
      )}
    </div>
  );
}

export function RequestBuilder({
  requestId,
  draft,
  update,
  collection,
  environment,
  variableNames,
  dirty,
  saving,
  sending,
  onSave,
  onSend,
  onOpenScope,
}: Props) {
  const [tab, setTab] = useState<Tab>(draft.definition.body.type !== "none" ? "body" : "params");
  const [beautifyHint, setBeautifyHint] = useState<string | null>(null);
  const def = draft.definition;
  const setDef = (fn: (d: RequestDefinition) => RequestDefinition) => update((d) => ({ ...d, definition: fn(d.definition) }));
  const env = ENVIRONMENT_LABELS[environment];
  const folder = collection?.folders.find((f) => f.id === draft.folderId);
  const inherited = inheritanceFor(draft.name, def, collection, draft.folderId);
  const scriptDot = (code: string) => (code.trim() ? <span className="w-1.5 h-1.5 rounded-full bg-tertiary" title="Script set" /> : null);

  const enabled = (rows: { enabled: boolean; key: string }[]) => rows.filter((r) => r.enabled && r.key.trim()).length;
  const tabs: { id: Tab; label: string; badge?: ReactNode }[] = [
    { id: "params", label: "Params", badge: enabled(def.params) ? <span className={COUNT}>{enabled(def.params)}</span> : null },
    {
      id: "auth",
      label: "Authorization",
      badge:
        def.auth.type === "inherit" ? (
          inherited.effective.auth.type !== "none" ? (
            <span className="text-outline font-label-sm text-label-sm" title="Inherited from parent">
              ↳
            </span>
          ) : null
        ) : def.auth.type !== "none" ? (
          <span className="text-tertiary font-label-sm text-label-sm">•</span>
        ) : null,
    },
    { id: "headers", label: "Headers", badge: enabled(def.headers) ? <span className={COUNT}>{enabled(def.headers)}</span> : null },
    { id: "body", label: "Body", badge: def.body.type !== "none" ? <span className="w-1.5 h-1.5 rounded-full bg-primary" /> : null },
    { id: "pre", label: PHASE_LABEL.pre, badge: scriptDot(def.preScript) },
    { id: "post", label: PHASE_LABEL.post, badge: scriptDot(def.postScript) },
    { id: "tests", label: "Tests", badge: def.assertions.length ? <span className={`${COUNT} text-secondary`}>{def.assertions.length}</span> : null },
    { id: "settings", label: "Settings" },
  ];

  const beautify = () => {
    if (def.body.type !== "json") return;
    const result = beautifyJson(def.body.text);
    if (result.ok) {
      setBeautifyHint(null);
      setDef((d) => (d.body.type === "json" ? { ...d, body: { type: "json", text: result.text } } : d));
    } else {
      setBeautifyHint(`Not valid JSON yet — ${result.error}`);
    }
  };

  return (
    <>
      {/* Top Request Command Bar */}
      <div className="p-space-sm bg-surface-container-low/60 flex flex-col gap-space-xs shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-space-sm min-w-0">
            <Icon name="http" className="text-primary text-headline-md" />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <input
                  aria-label="Request name"
                  className="font-headline-md text-headline-md text-on-surface font-semibold bg-transparent hover:bg-surface-container/50 focus:bg-surface-container px-1 rounded focus:outline-none transition-colors truncate max-w-xs md:max-w-md"
                  value={draft.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    update((d) => ({ ...d, name }));
                  }}
                />
                <span
                  className="px-1.5 py-0.5 rounded bg-surface-container-high font-label-sm text-label-sm text-outline whitespace-nowrap"
                  title="Request id"
                >
                  ID: {requestId}
                </span>
                {dirty && (
                  <span className="flex items-center gap-1 font-label-sm text-label-sm text-tertiary whitespace-nowrap" title="Unsaved changes">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary" /> unsaved
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 font-body-sm text-body-sm text-on-surface-variant min-w-0">
                <span className="truncate">{collection?.name ?? "…"}</span>
                <span className="text-outline">/</span>
                <select
                  aria-label="Folder"
                  title="Move to folder"
                  className="field-sizing-content bg-transparent hover:bg-surface-container rounded px-0.5 focus:outline-none cursor-pointer max-w-[12rem] truncate"
                  value={draft.folderId ?? ""}
                  onChange={(e) => {
                    const folderId = e.target.value || null;
                    update((d) => ({ ...d, folderId }));
                  }}
                >
                  <option value="">(no folder)</option>
                  {collection?.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {folder === undefined && draft.folderId !== null && <span className="text-outline">(missing)</span>}
                <span className="text-outline">/</span>
                <span className="text-primary font-medium truncate">{draft.name || "untitled"}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-space-xs">
            <AddToFlow name={draft.name} definition={def} collectionId={collection?.id} folderId={draft.folderId} />
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              title="Save Request (Ctrl/⌘+S)"
              className={`${GHOST_BUTTON} relative ${dirty ? "text-on-surface" : ""}`}
            >
              <Icon name={saving ? "progress_activity" : "save"} className={`text-body-md ${saving ? "animate-spin" : ""}`} />
              <span>Save</span>
              {dirty && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-tertiary" />}
            </button>
          </div>
        </div>

        {/* URL Construction Bar */}
        <form
          className="flex items-center gap-space-xs w-full bg-surface-container-lowest p-space-xxs rounded shadow-inner"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <div className="relative">
            <select
              aria-label="HTTP method"
              className={`appearance-none font-label-md text-label-md font-bold px-3 py-2 pr-7 rounded cursor-pointer focus:outline-none shadow-sm ${METHOD_SELECT_TONE[def.method]}`}
              value={def.method}
              onChange={(e) => {
                const method = e.target.value as RequestMethod;
                setDef((d) => ({ ...d, method }));
              }}
            >
              {REQUEST_METHODS.map((m) => (
                <option key={m} value={m} className="bg-surface-container text-on-surface">
                  {m}
                </option>
              ))}
            </select>
            <Icon name="arrow_drop_down" className="pointer-events-none absolute right-1.5 top-2 text-body-md" />
          </div>
          <div className="flex-1 flex items-center bg-surface-container px-3 py-1.5 rounded min-w-0">
            <TemplateInput
              aria-label="Request URL"
              className="flex-1 min-w-0 bg-transparent text-on-surface font-code-block text-code-block focus:outline-none placeholder:text-outline"
              placeholder="https://api.example.com/v1/orders  or  /api/demo/slack/messages"
              value={def.url}
              onValue={(url) => setDef((d) => ({ ...d, url }))}
            />
            <div className="flex items-center gap-1 pl-2">
              <span
                className={`px-1.5 py-0.5 rounded bg-surface-container-high font-label-sm text-label-sm whitespace-nowrap ${env.tone}`}
                title="Active target environment (change it in the top bar)"
              >
                {env.label}-{env.region}
              </span>
            </div>
          </div>
          <button
            type="submit"
            disabled={sending}
            className="flex items-center gap-1.5 px-space-md py-2 rounded bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-body-md font-bold transition-all shadow-md disabled:opacity-70"
          >
            <Icon name={sending ? "progress_activity" : "send"} className={`text-body-md ${sending ? "animate-spin" : ""}`} />
            <span>{sending ? "Sending" : "Send"}</span>
          </button>
        </form>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center justify-between px-space-sm bg-surface-container-lowest shadow-sm overflow-x-auto shrink-0">
        <div className="flex items-center gap-space-xxs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={tab === t.id ? TAB_ACTIVE : TAB_IDLE}
            >
              <span>{t.label}</span>
              {t.badge}
            </button>
          ))}
        </div>
        {tab === "body" && (
          <div className="flex items-center gap-space-xs py-1">
            <span className="font-label-sm text-label-sm text-outline">Format:</span>
            <select
              aria-label="Body format"
              className={`${SELECT} py-0.5 text-primary font-semibold`}
              value={def.body.type}
              onChange={(e) => {
                const type = e.target.value as RequestDefinition["body"]["type"];
                setBeautifyHint(null);
                setDef((d) => {
                  const text = d.body.type === "none" ? "" : d.body.text;
                  return { ...d, body: type === "none" ? { type } : { type, text } };
                });
              }}
            >
              <option value="none">none</option>
              <option value="json">raw (JSON)</option>
              <option value="text">raw (text)</option>
            </select>
            {def.body.type === "json" && (
              <button
                type="button"
                onClick={beautify}
                className="px-2 py-0.5 rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm transition-colors flex items-center gap-1"
              >
                <Icon name="auto_fix_high" className="text-body-sm" /> Beautify
              </button>
            )}
          </div>
        )}
      </div>

      {/* Editor panel */}
      <div className="h-72 flex flex-col bg-surface-container-lowest overflow-hidden shrink-0">
        {(tab === "params" || tab === "auth" || tab === "headers" || tab === "body") && <SuggestedTokens names={variableNames} />}
        {tab === "params" && (
          <KeyValueEditor
            label="Query params"
            keyPlaceholder="param"
            rows={def.params}
            onRows={(fn) => setDef((d) => ({ ...d, params: fn(d.params) }))}
          />
        )}
        {tab === "headers" && <InheritedHeaders inherited={inherited.headers} own={def.headers} />}
        {tab === "headers" && (
          <KeyValueEditor
            label="Headers"
            keyPlaceholder="Header-Name"
            rows={def.headers}
            onRows={(fn) => setDef((d) => ({ ...d, headers: fn(d.headers) }))}
          />
        )}
        {tab === "auth" && (
          <AuthPanel
            auth={def.auth}
            set={(fn) => setDef((d) => ({ ...d, auth: fn(d.auth) }))}
            level="request"
            allowInherit
            inherited={{ auth: inherited.effective.auth, source: inherited.authSource }}
            onOpenSource={onOpenScope}
          />
        )}
        {(tab === "pre" || tab === "post") && (
          <ScriptEditor
            key={tab}
            phase={tab}
            value={tab === "pre" ? def.preScript : def.postScript}
            onValue={(code) => setDef((d) => (tab === "pre" ? { ...d, preScript: code } : { ...d, postScript: code }))}
            self="this request"
            envNames={variableNames}
            inherited={tab === "pre" ? inherited.pre : inherited.post}
          />
        )}
        {tab === "body" &&
          (def.body.type === "none" ? (
            <div className="flex-1 flex items-center justify-center font-body-sm text-body-sm text-on-surface-variant">
              This request has no body. Pick a format above to add one.
            </div>
          ) : (
            <>
              {beautifyHint && (
                <div className="px-space-sm py-1 bg-tertiary-container/20 text-tertiary font-body-sm text-body-sm flex items-center gap-1">
                  <Icon name="info" className="text-body-sm" /> {beautifyHint}
                </div>
              )}
              {(def.method === "GET" || def.method === "HEAD") && (
                <div className="px-space-sm py-1 bg-surface-container-low text-outline font-body-sm text-body-sm">
                  {def.method} requests are sent without a body.
                </div>
              )}
              <CodeEditor
                label="Request body"
                value={def.body.text}
                placeholder={def.body.type === "json" ? '{\n  "id": "{{$guid}}"\n}' : "text body"}
                onValue={(text) => setDef((d) => (d.body.type === "none" ? d : { ...d, body: { ...d.body, text } }))}
              />
            </>
          ))}
        {tab === "tests" && <AssertionsEditor assertions={def.assertions} onChange={(fn) => setDef((d) => ({ ...d, assertions: fn(d.assertions) }))} />}
        {tab === "settings" && (
          <div className="flex-1 overflow-auto p-space-sm flex flex-col gap-space-md max-w-md">
            <label className="flex flex-col gap-space-xxs">
              <span className={LABEL}>Timeout (ms)</span>
              <input
                aria-label="Timeout"
                type="number"
                min={100}
                max={30000}
                step={100}
                className={FIELD}
                value={def.settings.timeoutMs}
                onChange={(e) => {
                  const timeoutMs = Math.min(30_000, Math.max(100, Math.trunc(Number(e.target.value)) || 100));
                  setDef((d) => ({ ...d, settings: { ...d.settings, timeoutMs } }));
                }}
              />
              <span className="font-body-sm text-body-sm text-outline">100 – 30,000 ms. Responses over 1 MB are rejected.</span>
            </label>
            <label className="flex items-center gap-space-sm cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 accent-primary"
                checked={def.settings.followRedirects}
                onChange={(e) => {
                  const followRedirects = e.target.checked;
                  setDef((d) => ({ ...d, settings: { ...d.settings, followRedirects } }));
                }}
              />
              <span className="font-body-sm text-body-sm text-on-surface">Follow redirects</span>
            </label>
          </div>
        )}
      </div>
    </>
  );
}
