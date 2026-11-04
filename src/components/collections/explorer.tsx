"use client";

import { useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import type { Collection, Folder, RequestSummary } from "@/lib/collections/schema";
import { MethodPill } from "./ui";

export type NodeKind = "collection" | "folder" | "request";
export type Renaming = { kind: NodeKind; id: string } | null;

type Props = {
  collections: Collection[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selectedDirty: boolean;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  onSelect: (id: string) => void;
  onNewCollection: () => void;
  onNewFolder: (collectionId: string) => void;
  onNewRequest: (collectionId: string, folderId: string | null) => void;
  onRename: (kind: NodeKind, id: string, name: string) => void;
  onDelete: (kind: NodeKind, id: string, name: string) => void;
  onImport: (format: "curl" | "openapi") => void;
};

const PILL =
  "flex items-center gap-1 px-space-xs py-space-xxs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant text-label-sm font-label-sm whitespace-nowrap transition-colors disabled:opacity-40";
const HOVER_BTN = "p-0.5 rounded text-outline hover:text-on-surface hover:bg-surface-container-highest";

function RenameInput({ initial, onDone }: { initial: string; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(initial);
  // Enter/Escape unmount the input, which can also fire blur; only report once.
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      aria-label="Name"
      className="flex-1 min-w-0 bg-surface-container-highest rounded px-1 text-on-surface font-body-sm text-body-sm focus:outline-none"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={() => finish(value.trim() || null)}
    />
  );
}

function HoverActions({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-px opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

export function Explorer(props: Props) {
  const { collections, loading, error, selectedId, selectedDirty, renaming, setRenaming, onSelect, onNewCollection, onNewFolder, onNewRequest, onRename, onDelete, onImport } = props;
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();
  const matches = (r: RequestSummary) => !q || `${r.method} ${r.name} ${r.url}`.toLowerCase().includes(q);
  const toggle = (id: string) =>
    setCollapsed((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const isOpen = (id: string) => q !== "" || !collapsed.has(id);
  const activeCollection =
    collections.find((c) => c.requests.some((r) => r.id === selectedId))?.id ?? collections[0]?.id;

  const finishRename = (kind: NodeKind, id: string, original: string) => (name: string | null) => {
    setRenaming(null);
    if (name && name !== original) onRename(kind, id, name);
  };

  const requestRow = (r: RequestSummary) => {
    const selected = r.id === selectedId;
    const editing = renaming?.kind === "request" && renaming.id === r.id;
    return (
      <div
        key={r.id}
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        onClick={() => onSelect(r.id)}
        onKeyDown={(e) => e.key === "Enter" && onSelect(r.id)}
        onDoubleClick={() => setRenaming({ kind: "request", id: r.id })}
        title={r.url || r.name}
        className={`flex items-center justify-between gap-1 px-space-xs py-1 rounded cursor-pointer group transition-colors ${
          selected ? "bg-surface-container-high shadow-inner" : "hover:bg-surface-container-high/50"
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <MethodPill method={r.method} active={selected} />
          {editing ? (
            <RenameInput initial={r.name} onDone={finishRename("request", r.id, r.name)} />
          ) : (
            <span
              className={`font-body-sm text-body-sm truncate ${
                selected ? "text-on-surface font-medium" : "text-on-surface-variant group-hover:text-on-surface"
              }`}
            >
              {r.name}
            </span>
          )}
        </div>
        {!editing && (
          <>
            <HoverActions>
              <button type="button" className={HOVER_BTN} title="Rename" onClick={() => setRenaming({ kind: "request", id: r.id })}>
                <Icon name="edit" className="text-body-sm" />
              </button>
              <button type="button" className={HOVER_BTN} title="Delete request" onClick={() => onDelete("request", r.id, r.name)}>
                <Icon name="delete" className="text-body-sm" />
              </button>
            </HoverActions>
            {selected && (
              <span
                className={`w-1.5 h-1.5 shrink-0 rounded-full ${selectedDirty ? "bg-tertiary animate-pulse" : "bg-primary"}`}
                title={selectedDirty ? "Unsaved changes" : undefined}
              />
            )}
          </>
        )}
      </div>
    );
  };

  const folderBlock = (c: Collection, f: Folder) => {
    const requests = c.requests.filter((r) => r.folderId === f.id);
    const visible = requests.filter(matches);
    if (q && visible.length === 0 && !f.name.toLowerCase().includes(q)) return null;
    const open = isOpen(f.id);
    const holdsSelection = requests.some((r) => r.id === selectedId);
    const editing = renaming?.kind === "folder" && renaming.id === f.id;
    return (
      <div key={f.id} className={`rounded ${holdsSelection ? "bg-surface-container-lowest/50 p-space-xxs" : "hover:bg-surface-container/80"} transition-colors`}>
        <div
          role="treeitem"
          aria-expanded={open}
          aria-selected={false}
          tabIndex={0}
          onClick={() => toggle(f.id)}
          onKeyDown={(e) => e.key === "Enter" && toggle(f.id)}
          onDoubleClick={() => setRenaming({ kind: "folder", id: f.id })}
          className="px-space-xs py-1 flex items-center justify-between gap-1 cursor-pointer select-none group text-on-surface-variant"
        >
          <div className={`flex items-center gap-1 text-body-sm font-body-sm min-w-0 flex-1 ${holdsSelection ? "text-on-surface font-medium" : ""}`}>
            <Icon name={open ? "arrow_drop_down" : "arrow_right"} className={`text-body-sm ${open ? "text-primary" : "text-outline"}`} />
            <Icon name={open ? "folder_open" : "folder"} className={`text-body-sm ${open ? "text-primary" : "text-tertiary-fixed-dim"}`} />
            {editing ? <RenameInput initial={f.name} onDone={finishRename("folder", f.id, f.name)} /> : <span className="truncate">{f.name}</span>}
          </div>
          {!editing && (
            <>
              <HoverActions>
                <button type="button" className={HOVER_BTN} title="New request in folder" onClick={() => onNewRequest(c.id, f.id)}>
                  <Icon name="add" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Rename folder" onClick={() => setRenaming({ kind: "folder", id: f.id })}>
                  <Icon name="edit" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Delete folder" onClick={() => onDelete("folder", f.id, f.name)}>
                  <Icon name="delete" className="text-body-sm" />
                </button>
              </HoverActions>
              <span
                className={`px-1 rounded font-label-sm text-label-sm ${holdsSelection ? "bg-surface-container text-primary" : "text-outline"}`}
              >
                {requests.length}
              </span>
            </>
          )}
        </div>
        {open && (
          <div className="pl-4 pt-0.5 space-y-0.5">
            {visible.map(requestRow)}
            {requests.length === 0 && <div className="px-space-xs py-0.5 font-body-sm text-body-sm text-outline">Empty folder</div>}
          </div>
        )}
      </div>
    );
  };

  const collectionBlock = (c: Collection) => {
    const nameHit = !q || c.name.toLowerCase().includes(q);
    const anyHit = c.requests.some(matches) || c.folders.some((f) => f.name.toLowerCase().includes(q));
    if (!nameHit && !anyHit) return null;
    const open = isOpen(c.id);
    const editing = renaming?.kind === "collection" && renaming.id === c.id;
    const loose = c.requests.filter((r) => r.folderId === null && matches(r));
    return (
      <div key={c.id} className={`rounded overflow-hidden transition-colors ${open ? "bg-surface-container/60 shadow-sm" : "bg-surface-container/40 hover:bg-surface-container/70"}`}>
        <div
          role="treeitem"
          aria-expanded={open}
          aria-selected={false}
          tabIndex={0}
          onClick={() => toggle(c.id)}
          onKeyDown={(e) => e.key === "Enter" && toggle(c.id)}
          onDoubleClick={() => setRenaming({ kind: "collection", id: c.id })}
          className="px-space-sm py-space-xs flex items-center justify-between gap-1 hover:bg-surface-container cursor-pointer select-none group"
        >
          <div className="flex items-center gap-space-xs min-w-0 flex-1">
            <Icon name={open ? "arrow_drop_down" : "arrow_right"} className={`text-body-md ${open ? "text-primary" : "text-outline"}`} />
            <Icon name="layers" className="text-primary-fixed-dim text-body-md" />
            {editing ? (
              <RenameInput initial={c.name} onDone={finishRename("collection", c.id, c.name)} />
            ) : (
              <span className={`text-body-md truncate ${open ? "font-headline-sm text-on-surface font-semibold" : "font-body-md text-on-surface-variant"}`}>
                {c.name}
              </span>
            )}
          </div>
          {!editing && (
            <>
              <HoverActions>
                <button type="button" className={HOVER_BTN} title="New request" onClick={() => onNewRequest(c.id, null)}>
                  <Icon name="add" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="New folder" onClick={() => onNewFolder(c.id)}>
                  <Icon name="create_new_folder" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Rename collection" onClick={() => setRenaming({ kind: "collection", id: c.id })}>
                  <Icon name="edit" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Delete collection" onClick={() => onDelete("collection", c.id, c.name)}>
                  <Icon name="delete" className="text-body-sm" />
                </button>
              </HoverActions>
              <span className="px-1 py-0.5 rounded bg-surface-container-highest font-label-sm text-label-sm text-outline" title="Requests">
                {c.requests.length}
              </span>
            </>
          )}
        </div>
        {open && (
          <div className="pl-space-sm pr-space-xxs py-space-xxs space-y-space-xxs" role="group">
            {c.folders.map((f) => folderBlock(c, f))}
            {loose.length > 0 && <div className="space-y-0.5">{loose.map(requestRow)}</div>}
            {c.requests.length === 0 && c.folders.length === 0 && (
              <button
                type="button"
                onClick={() => onNewRequest(c.id, null)}
                className="w-full text-left px-space-xs py-1 font-body-sm text-body-sm text-outline hover:text-primary"
              >
                + Add a request
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="w-full xl:w-80 flex-shrink-0 bg-surface-container-low flex flex-col overflow-hidden">
      {/* Search & Command Header */}
      <div className="p-space-sm bg-surface-container-lowest/80 flex flex-col gap-space-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-xs">
            <Icon name="folder_data" className="text-primary text-headline-sm" />
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">API Collections</span>
          </div>
          <div className="flex items-center gap-space-xxs">
            <button
              type="button"
              onClick={() => onImport("curl")}
              title="Import cURL / OpenAPI"
              className="p-space-xs rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <Icon name="publish" className="text-body-md" />
            </button>
            <button
              type="button"
              onClick={onNewCollection}
              title="New Collection"
              className="p-space-xs rounded bg-primary-container/20 hover:bg-primary-container/30 text-primary transition-colors"
            >
              <Icon name="create_new_folder" className="text-body-md" />
            </button>
          </div>
        </div>
        <div className="relative flex items-center">
          <Icon name="filter_list" className="absolute left-2 text-outline text-body-md pointer-events-none" />
          <input
            aria-label="Filter requests"
            className="w-full pl-7 pr-3 py-1 bg-surface-container rounded font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors"
            placeholder="Filter requests, URLs or methods..."
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          />
        </div>
        <div className="flex items-center gap-space-xs overflow-x-auto py-0.5">
          <button type="button" className={PILL} onClick={onNewCollection}>
            <Icon name="add" className="text-body-sm text-primary" /> Collection
          </button>
          <button
            type="button"
            className={PILL}
            disabled={!activeCollection}
            title={activeCollection ? "New folder in the current collection" : "Create a collection first"}
            onClick={() => activeCollection && onNewFolder(activeCollection)}
          >
            <Icon name="create_new_folder" className="text-body-sm text-tertiary" /> Folder
          </button>
          <button type="button" className={PILL} onClick={() => onImport("openapi")}>
            <Icon name="file_download" className="text-body-sm text-secondary" /> OpenAPI
          </button>
          <button type="button" className={PILL} onClick={() => onImport("curl")}>
            <Icon name="terminal" className="text-body-sm text-primary-fixed" /> cURL
          </button>
        </div>
      </div>

      {/* Collections Tree */}
      <div className="flex-1 overflow-y-auto p-space-xs space-y-space-xs" role="tree" aria-label="Collections">
        {loading && <div className="p-space-sm font-body-sm text-body-sm text-on-surface-variant">Loading collections…</div>}
        {error && <div className="p-space-sm font-body-sm text-body-sm text-error">{error}</div>}
        {!loading && !error && collections.length === 0 && (
          <div className="p-space-md rounded bg-surface-container-lowest flex flex-col gap-space-sm items-start">
            <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider">No collections yet</div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              Group saved requests into collections and folders, or import them from a cURL command or an OpenAPI spec.
            </p>
            <div className="flex flex-wrap gap-space-xs">
              <button
                type="button"
                onClick={onNewCollection}
                className="flex items-center gap-1 px-space-sm py-1 rounded bg-primary text-on-primary font-label-sm text-label-sm font-semibold"
              >
                <Icon name="add" className="text-body-sm" /> New collection
              </button>
              <button
                type="button"
                onClick={() => onImport("curl")}
                className="flex items-center gap-1 px-space-sm py-1 rounded bg-surface-container-high text-on-surface font-label-sm text-label-sm"
              >
                <Icon name="publish" className="text-body-sm" /> Import cURL / OpenAPI
              </button>
            </div>
          </div>
        )}
        {collections.map(collectionBlock)}
        {q && collections.length > 0 && collections.every((c) => !c.name.toLowerCase().includes(q) && !c.requests.some(matches) && !c.folders.some((f) => f.name.toLowerCase().includes(q))) && (
          <div className="p-space-sm font-body-sm text-body-sm text-on-surface-variant">No requests match “{query}”.</div>
        )}
      </div>
    </aside>
  );
}
