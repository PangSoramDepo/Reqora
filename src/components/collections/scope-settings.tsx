"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { folderChain, subtreeIds } from "@/lib/collections/folders";
import type { Collection, Folder, ScopeSettings } from "@/lib/collections/schema";
import { AuthPanel, type InheritSource } from "./auth-panel";
import { folderInheritance, InheritedHeaders } from "./inherited";
import { KeyValueEditor } from "./key-value-editor";
import { PHASE_LABEL, ScriptEditor } from "./script-editor";
import { GHOST_BUTTON } from "./ui";

type Tab = "auth" | "headers" | "pre" | "post";

const TAB_IDLE = "px-space-sm py-2 text-on-surface-variant hover:text-on-surface font-label-md text-label-md transition-colors flex items-center gap-1.5";
const TAB_ACTIVE = "px-space-sm py-2 text-primary font-label-md text-label-md bg-surface-container-high rounded-t font-semibold flex items-center gap-1.5 shadow-sm";
const DOT = <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />;

type Props = {
  collection: Collection;
  /** Set when editing a folder's settings; otherwise the collection's. */
  folder?: Folder;
  settings: ScopeSettings;
  update: (fn: (s: ScopeSettings) => ScopeSettings) => void;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onOpenSource: (source: InheritSource) => void;
  /** Variable names in the selected environment, for script suggestions. */
  variableNames?: string[];
};

/** Postman-style collection / folder settings: auth, headers and scripts shared by the requests inside. */
export function ScopeSettingsPanel({ collection, folder, settings, update, dirty, saving, error, onSave, onOpenSource, variableNames }: Props) {
  const [tab, setTab] = useState<Tab>("auth");
  const kind = folder ? "folder" : "collection";
  const name = folder?.name ?? collection.name;
  const inherited = folder ? folderInheritance(folder, settings, collection) : null;
  // Requests anywhere inside, sub-folders included.
  const inside = folder ? subtreeIds(collection.folders, folder.id) : null;
  const requestCount = inside ? collection.requests.filter((r) => r.folderId !== null && inside.has(r.folderId)).length : collection.requests.length;
  const ancestors = folder ? folderChain(collection.folders, folder.parentId) : [];

  const enabledHeaders = settings.headers.filter((h) => h.enabled && h.key.trim()).length;
  const authSet = folder ? settings.auth.type !== "inherit" : settings.auth.type !== "inherit" && settings.auth.type !== "none";
  const tabs: { id: Tab; label: string; badge?: ReactNode }[] = [
    { id: "auth", label: "Authorization", badge: authSet ? DOT : null },
    { id: "headers", label: "Headers", badge: enabledHeaders ? <span className="px-1 rounded bg-surface-container font-label-sm text-label-sm">{enabledHeaders}</span> : null },
    { id: "pre", label: PHASE_LABEL.pre, badge: settings.preScript.trim() ? DOT : null },
    { id: "post", label: PHASE_LABEL.post, badge: settings.postScript.trim() ? DOT : null },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="scope-settings">
      <div className="p-space-sm bg-surface-container-low/60 flex flex-col gap-space-xs shadow-sm">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-space-sm min-w-0">
            <Icon name={folder ? "folder_open" : "layers"} className={`text-headline-md ${folder ? "text-tertiary-fixed-dim" : "text-primary-fixed-dim"}`} />
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-headline-md text-headline-md text-on-surface font-semibold truncate">{name}</span>
                <span className="px-1.5 py-0.5 rounded bg-surface-container-high font-label-sm text-label-sm text-outline whitespace-nowrap">
                  {kind === "folder" ? "Folder settings" : "Collection settings"}
                </span>
                {dirty && (
                  <span className="flex items-center gap-1 font-label-sm text-label-sm text-tertiary whitespace-nowrap" title="Unsaved changes">
                    <span className="w-1.5 h-1.5 rounded-full bg-tertiary" /> unsaved
                  </span>
                )}
              </div>
              <div className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1 min-w-0">
                {folder ? (
                  <>
                    <button type="button" className="hover:text-primary truncate" onClick={() => onOpenSource({ scope: "collection", id: collection.id, name: collection.name })}>
                      {collection.name}
                    </button>
                    {ancestors.map((a) => (
                      <span key={a.id} className="contents">
                        <span className="text-outline">/</span>
                        <button type="button" className="hover:text-primary truncate" onClick={() => onOpenSource({ scope: "folder", id: a.id, name: a.name })}>
                          {a.name}
                        </button>
                      </span>
                    ))}
                    <span className="text-outline">/</span>
                    <span className="text-primary font-medium truncate">{folder.name}</span>
                  </>
                ) : (
                  <span>{collection.folders.length} folders</span>
                )}
                <span className="text-outline">·</span>
                <span>
                  {requestCount} {requestCount === 1 ? "request" : "requests"}
                </span>
              </div>
            </div>
          </div>
          <button type="button" onClick={onSave} disabled={saving} title="Save settings (Ctrl/⌘+S)" className={`${GHOST_BUTTON} relative ${dirty ? "text-on-surface" : ""}`}>
            <Icon name={saving ? "progress_activity" : "save"} className={`text-body-md ${saving ? "animate-spin" : ""}`} />
            <span>Save</span>
            {dirty && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-tertiary" />}
          </button>
        </div>
        <p className="font-body-sm text-body-sm text-on-surface-variant flex items-start gap-1">
          <Icon name="info" className="text-body-sm text-primary mt-0.5" />
          <span>
            {folder
              ? "Requests and sub-folders in this folder inherit its auth (when set to Inherit), its headers and its scripts. The folder itself inherits from the collection and the folders above it: headers merge (the most specific wins), scripts run collection → outer folders → this folder → request."
              : "Every request in this collection inherits these unless a folder or request overrides them: auth applies to requests set to Inherit, headers merge (the most specific wins), scripts run collection → folder → request."}
          </span>
        </p>
        {error && (
          <div role="alert" className="px-space-sm py-1 rounded bg-error-container/40 text-on-error-container font-body-sm text-body-sm flex items-center gap-1">
            <Icon name="error" className="text-body-sm" /> {error}
          </div>
        )}
      </div>

      <div className="flex items-center px-space-sm bg-surface-container-lowest shadow-sm overflow-x-auto shrink-0" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={tab === t.id ? TAB_ACTIVE : TAB_IDLE}>
            <span>{t.label}</span>
            {t.badge}
          </button>
        ))}
      </div>

      <div className="flex-1 flex flex-col bg-surface-container-lowest overflow-hidden min-h-0">
        {tab === "auth" && (
          <AuthPanel
            auth={settings.auth}
            set={(fn) => update((s) => ({ ...s, auth: fn(s.auth) }))}
            level={kind}
            allowInherit={Boolean(folder)}
            inherited={inherited ? { auth: inherited.effective.auth, source: inherited.authSource } : undefined}
            onOpenSource={onOpenSource}
          />
        )}
        {tab === "headers" && (
          <>
            {inherited && <InheritedHeaders inherited={inherited.headers} own={settings.headers} />}
            <KeyValueEditor
              label={`${kind === "folder" ? "Folder" : "Collection"} headers`}
              keyPlaceholder="Header-Name"
              rows={settings.headers}
              onRows={(fn) => update((s) => ({ ...s, headers: fn(s.headers) }))}
            />
          </>
        )}
        {(tab === "pre" || tab === "post") && (
          <ScriptEditor
            key={tab}
            phase={tab}
            value={tab === "pre" ? settings.preScript : settings.postScript}
            onValue={(code) => update((s) => (tab === "pre" ? { ...s, preScript: code } : { ...s, postScript: code }))}
            self={`this ${kind}`}
            envNames={variableNames}
            inherited={inherited ? (tab === "pre" ? inherited.pre : inherited.post) : []}
          />
        )}
      </div>
    </div>
  );
}
