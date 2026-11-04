"use client";

import { useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import type { Collection, Folder, RequestSummary, ScopeSettings } from "@/lib/collections/schema";
import { REQUEST_DRAG_MIME } from "@/lib/workflows/defaults";
import { MethodPill } from "./ui";

export type NodeKind = "collection" | "folder" | "request";
export type Renaming = { kind: NodeKind; id: string } | null;
export type ScopeRef = { kind: "collection" | "folder"; id: string };
export type RequestTarget = { collectionId: string; folderId: string | null; index: number };

type Props = {
  collections: Collection[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  selectedDirty: boolean;
  /** Collection or folder whose settings are open. */
  selectedScope: ScopeRef | null;
  renaming: Renaming;
  setRenaming: (r: Renaming) => void;
  onSelect: (id: string) => void;
  onOpenSettings: (scope: ScopeRef) => void;
  onNewCollection: () => void;
  onNewFolder: (collectionId: string) => void;
  onNewRequest: (collectionId: string, folderId: string | null) => void;
  onRename: (kind: NodeKind, id: string, name: string) => void;
  onDelete: (kind: NodeKind, id: string, name: string) => void;
  /** Copies the saved item as "<name> Copy" (unsaved edits to an open request are not included). */
  onDuplicate: (kind: NodeKind, id: string) => void;
  onImport: (format: "curl" | "openapi") => void;
  /** `index` is the position among the target container's requests, not counting the moved one. */
  onMoveRequest: (id: string, target: RequestTarget) => void;
  /** `index` is the position among the collection's folders, not counting the moved one. */
  onMoveFolder: (id: string, index: number) => void;
};

/** Folder MIME for explorer-only folder drags (never accepted by the canvas). */
const FOLDER_DRAG_MIME = "application/x-reqora-folder";
const EXPAND_DELAY_MS = 600;

type Drag = { kind: "request"; id: string } | { kind: "folder"; id: string; collectionId: string };
/** Where the dragged item would land: before/after a row, into a folder/collection, or "none" = not allowed. */
type DropAt = { id: string; where: "before" | "after" | "into" | "none" };

const PILL =
  "flex items-center gap-1 px-space-xs py-space-xxs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant text-label-sm font-label-sm whitespace-nowrap transition-colors disabled:opacity-40";
const HOVER_BTN = "p-0.5 rounded text-outline hover:text-on-surface hover:bg-surface-container-highest disabled:opacity-30 disabled:pointer-events-none";

const hasSettings = (s: ScopeSettings) =>
  (s.auth.type !== "inherit" && s.auth.type !== "none") || s.headers.some((h) => h.enabled && h.key.trim()) || Boolean(s.preScript.trim() || s.postScript.trim());

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

/** Insertion line drawn at the top or bottom edge of a row while dragging. */
function DropLine({ where }: { where: DropAt["where"] | undefined }) {
  if (where !== "before" && where !== "after") return null;
  return (
    <span
      aria-hidden="true"
      data-testid="drop-line"
      className={`pointer-events-none absolute left-1 right-1 h-0.5 rounded-full bg-primary shadow-[0_0_4px] shadow-primary ${where === "before" ? "-top-px" : "-bottom-px"}`}
    />
  );
}

export function Explorer(props: Props) {
  const {
    collections,
    loading,
    error,
    selectedId,
    selectedDirty,
    selectedScope,
    renaming,
    setRenaming,
    onSelect,
    onOpenSettings,
    onNewCollection,
    onNewFolder,
    onNewRequest,
    onRename,
    onDelete,
    onDuplicate,
    onImport,
    onMoveRequest,
    onMoveFolder,
  } = props;
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropAt, setDropAt] = useState<DropAt | null>(null);
  const expandTimer = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);

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
    (selectedScope?.kind === "collection" ? selectedScope.id : undefined) ??
    collections.find((c) => c.requests.some((r) => r.id === selectedId) || c.folders.some((f) => f.id === selectedScope?.id))?.id ??
    collections[0]?.id;

  const finishRename = (kind: NodeKind, id: string, original: string) => (name: string | null) => {
    setRenaming(null);
    if (name && name !== original) onRename(kind, id, name);
  };

  // ---- Drag & drop -------------------------------------------------------------------------------

  const clearExpand = () => {
    if (expandTimer.current) clearTimeout(expandTimer.current.timer);
    expandTimer.current = null;
  };
  /** Opens a collapsed folder/collection after hovering it for a moment while dragging. */
  const hoverExpand = (id: string) => {
    if (isOpen(id) || expandTimer.current?.id === id) return;
    clearExpand();
    expandTimer.current = {
      id,
      timer: setTimeout(() => {
        expandTimer.current = null;
        setCollapsed((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      }, EXPAND_DELAY_MS),
    };
  };
  const endDrag = () => {
    clearExpand();
    setDrag(null);
    setDropAt(null);
  };
  const mark = (id: string, where: DropAt["where"]) => setDropAt((cur) => (cur?.id === id && cur.where === where ? cur : { id, where }));
  const half = (e: DragEvent<HTMLElement>): "before" | "after" => {
    const rect = e.currentTarget.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };
  /** Marks this element as the drop target; stops the tree's "nothing here" handler. */
  const accept = (e: DragEvent<HTMLElement>, id: string, where: DropAt["where"]) => {
    e.stopPropagation();
    if (where !== "none") {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
    mark(id, where);
  };

  const performDrop = (d: Drag, at: DropAt) => {
    if (at.where === "none") return;
    if (d.kind === "folder") {
      const c = collections.find((x) => x.id === d.collectionId);
      if (!c || at.where === "into") return;
      const others = c.folders.filter((f) => f.id !== d.id);
      const i = others.findIndex((f) => f.id === at.id);
      if (i >= 0) onMoveFolder(d.id, i + (at.where === "after" ? 1 : 0));
      return;
    }
    const siblings = (c: Collection, folderId: string | null) => c.requests.filter((r) => r.folderId === folderId && r.id !== d.id);
    for (const c of collections) {
      const row = c.requests.find((r) => r.id === at.id);
      if (row) {
        if (row.id === d.id) return;
        const list = siblings(c, row.folderId);
        onMoveRequest(d.id, { collectionId: c.id, folderId: row.folderId, index: list.findIndex((r) => r.id === row.id) + (at.where === "after" ? 1 : 0) });
        return;
      }
      const folder = c.folders.find((f) => f.id === at.id);
      if (folder) {
        onMoveRequest(d.id, { collectionId: c.id, folderId: folder.id, index: siblings(c, folder.id).length });
        return;
      }
      if (c.id === at.id) {
        onMoveRequest(d.id, { collectionId: c.id, folderId: null, index: siblings(c, null).length });
        return;
      }
    }
  };

  // ---- Keyboard / button moves --------------------------------------------------------------------

  const requestNeighbours = (c: Collection, r: RequestSummary) => {
    const list = c.requests.filter((x) => x.folderId === r.folderId);
    return { index: list.findIndex((x) => x.id === r.id), count: list.length };
  };
  const moveRequestBy = (c: Collection, r: RequestSummary, delta: number) => {
    const { index, count } = requestNeighbours(c, r);
    const to = index + delta;
    if (index < 0 || to < 0 || to >= count) return;
    onMoveRequest(r.id, { collectionId: c.id, folderId: r.folderId, index: to });
  };
  const moveFolderBy = (c: Collection, f: Folder, delta: number) => {
    const index = c.folders.findIndex((x) => x.id === f.id);
    const to = index + delta;
    if (index < 0 || to < 0 || to >= c.folders.length) return;
    onMoveFolder(f.id, to);
  };
  /** Alt+↑ / Alt+↓ on a focused row moves it. */
  const moveKeys = (e: KeyboardEvent, move: (delta: number) => void) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return false;
    e.preventDefault();
    move(e.key === "ArrowUp" ? -1 : 1);
    return true;
  };

  // ---- Rows -------------------------------------------------------------------------------------

  const requestRow = (c: Collection, r: RequestSummary) => {
    const selected = r.id === selectedId;
    const editing = renaming?.kind === "request" && renaming.id === r.id;
    const { index, count } = requestNeighbours(c, r);
    const target = dropAt?.id === r.id ? dropAt.where : undefined;
    return (
      <div
        key={r.id}
        role="treeitem"
        aria-selected={selected}
        tabIndex={0}
        data-request-id={r.id}
        draggable={!editing}
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.setData(REQUEST_DRAG_MIME, r.id);
          e.dataTransfer.effectAllowed = "copyMove";
          setDrag({ kind: "request", id: r.id });
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (drag?.kind !== "request" || drag.id === r.id) return;
          clearExpand();
          accept(e, r.id, half(e));
        }}
        onClick={() => onSelect(r.id)}
        onKeyDown={(e) => {
          if (moveKeys(e, (d) => moveRequestBy(c, r, d))) return;
          if (e.key === "Enter") onSelect(r.id);
        }}
        onDoubleClick={() => setRenaming({ kind: "request", id: r.id })}
        title={`${r.url || r.name}\nDrag to reorder or onto the Flow Canvas · Alt+↑/↓ to move`}
        className={`relative flex items-center justify-between gap-1 px-space-xs py-1 rounded cursor-pointer group transition-colors ${
          selected ? "bg-surface-container-high shadow-inner" : "hover:bg-surface-container-high/50"
        } ${drag?.kind === "request" && drag.id === r.id ? "opacity-40" : ""}`}
      >
        <DropLine where={target} />
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
              <button type="button" className={HOVER_BTN} title="Move up (Alt+↑)" disabled={index <= 0} onClick={() => moveRequestBy(c, r, -1)}>
                <Icon name="arrow_upward" className="text-body-sm" />
              </button>
              <button type="button" className={HOVER_BTN} title="Move down (Alt+↓)" disabled={index >= count - 1} onClick={() => moveRequestBy(c, r, 1)}>
                <Icon name="arrow_downward" className="text-body-sm" />
              </button>
              <button type="button" className={HOVER_BTN} title="Rename" onClick={() => setRenaming({ kind: "request", id: r.id })}>
                <Icon name="edit" className="text-body-sm" />
              </button>
              <button type="button" className={HOVER_BTN} title="Duplicate request (saved version)" onClick={() => onDuplicate("request", r.id)}>
                <Icon name="content_copy" className="text-body-sm" />
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
    const scopeSelected = selectedScope?.kind === "folder" && selectedScope.id === f.id;
    const editing = renaming?.kind === "folder" && renaming.id === f.id;
    const target = dropAt?.id === f.id ? dropAt.where : undefined;
    const index = c.folders.findIndex((x) => x.id === f.id);
    const acceptInto = (e: DragEvent<HTMLElement>) => {
      if (drag?.kind !== "request") return;
      hoverExpand(f.id);
      accept(e, f.id, "into");
    };
    return (
      <div
        key={f.id}
        className={`rounded ${holdsSelection ? "bg-surface-container-lowest/50 p-space-xxs" : "hover:bg-surface-container/80"} ${
          drag?.kind === "folder" && drag.id === f.id ? "opacity-40" : ""
        } transition-colors`}
      >
        <div
          role="treeitem"
          aria-expanded={open}
          aria-selected={scopeSelected}
          tabIndex={0}
          data-folder-id={f.id}
          draggable={!editing}
          onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData(FOLDER_DRAG_MIME, f.id);
            e.dataTransfer.effectAllowed = "move";
            setDrag({ kind: "folder", id: f.id, collectionId: c.id });
          }}
          onDragEnd={endDrag}
          onDragOver={(e) => {
            if (drag?.kind === "request") acceptInto(e);
            else if (drag?.kind === "folder" && drag.id !== f.id) {
              clearExpand();
              // Folders only reorder within their own collection.
              accept(e, f.id, drag.collectionId === c.id ? half(e) : "none");
            }
          }}
          onClick={() => toggle(f.id)}
          onKeyDown={(e) => {
            if (moveKeys(e, (d) => moveFolderBy(c, f, d))) return;
            if (e.key === "Enter") toggle(f.id);
          }}
          onDoubleClick={() => setRenaming({ kind: "folder", id: f.id })}
          title="Drag to reorder · Alt+↑/↓ to move"
          className={`relative px-space-xs py-1 flex items-center justify-between gap-1 cursor-pointer select-none group text-on-surface-variant rounded transition-colors ${
            target === "into" ? "bg-primary/15 ring-1 ring-primary" : target === "none" ? "ring-1 ring-error/60 cursor-no-drop" : scopeSelected ? "bg-primary/10" : ""
          }`}
        >
          <DropLine where={target} />
          <div className={`flex items-center gap-1 text-body-sm font-body-sm min-w-0 flex-1 ${holdsSelection || scopeSelected ? "text-on-surface font-medium" : ""}`}>
            <Icon name={open ? "arrow_drop_down" : "arrow_right"} className={`text-body-sm ${open ? "text-primary" : "text-outline"}`} />
            <Icon name={open ? "folder_open" : "folder"} className={`text-body-sm ${open ? "text-primary" : "text-tertiary-fixed-dim"}`} />
            {editing ? <RenameInput initial={f.name} onDone={finishRename("folder", f.id, f.name)} /> : <span className="truncate">{f.name}</span>}
            {!editing && hasSettings(f.settings) && <Icon name="tune" className="text-body-sm text-outline" />}
          </div>
          {!editing && (
            <>
              <HoverActions>
                <button type="button" className={HOVER_BTN} title="Move up (Alt+↑)" disabled={index <= 0} onClick={() => moveFolderBy(c, f, -1)}>
                  <Icon name="arrow_upward" className="text-body-sm" />
                </button>
                <button
                  type="button"
                  className={HOVER_BTN}
                  title="Move down (Alt+↓)"
                  disabled={index >= c.folders.length - 1}
                  onClick={() => moveFolderBy(c, f, 1)}
                >
                  <Icon name="arrow_downward" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Folder settings (auth, headers, scripts)" onClick={() => onOpenSettings({ kind: "folder", id: f.id })}>
                  <Icon name="settings" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="New request in folder" onClick={() => onNewRequest(c.id, f.id)}>
                  <Icon name="add" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Rename folder" onClick={() => setRenaming({ kind: "folder", id: f.id })}>
                  <Icon name="edit" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Duplicate folder" onClick={() => onDuplicate("folder", f.id)}>
                  <Icon name="content_copy" className="text-body-sm" />
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
            {visible.map((r) => requestRow(c, r))}
            {requests.length === 0 && (
              <div className="px-space-xs py-0.5 font-body-sm text-body-sm text-outline" onDragOver={acceptInto}>
                {drag?.kind === "request" ? "Drop here" : "Empty folder"}
              </div>
            )}
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
    const scopeSelected = selectedScope?.kind === "collection" && selectedScope.id === c.id;
    const loose = c.requests.filter((r) => r.folderId === null && matches(r));
    const target = dropAt?.id === c.id ? dropAt.where : undefined;
    const acceptInto = (e: DragEvent<HTMLElement>) => {
      if (drag?.kind === "request") {
        hoverExpand(c.id);
        accept(e, c.id, "into");
      } else if (drag?.kind === "folder" && drag.collectionId !== c.id) {
        // Folders can't move across collections.
        accept(e, c.id, "none");
      }
    };
    return (
      <div key={c.id} className={`rounded overflow-hidden transition-colors ${open ? "bg-surface-container/60 shadow-sm" : "bg-surface-container/40 hover:bg-surface-container/70"}`}>
        <div
          role="treeitem"
          aria-expanded={open}
          aria-selected={scopeSelected}
          tabIndex={0}
          data-collection-id={c.id}
          onDragOver={acceptInto}
          onClick={() => toggle(c.id)}
          onKeyDown={(e) => e.key === "Enter" && toggle(c.id)}
          onDoubleClick={() => setRenaming({ kind: "collection", id: c.id })}
          className={`px-space-sm py-space-xs flex items-center justify-between gap-1 hover:bg-surface-container cursor-pointer select-none group transition-colors ${
            target === "into" ? "bg-primary/15 ring-1 ring-inset ring-primary" : target === "none" ? "ring-1 ring-inset ring-error/60 cursor-no-drop" : scopeSelected ? "bg-primary/10" : ""
          }`}
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
            {!editing && hasSettings(c.settings) && <Icon name="tune" className="text-body-sm text-outline" />}
          </div>
          {!editing && (
            <>
              <HoverActions>
                <button type="button" className={HOVER_BTN} title="Collection settings (auth, headers, scripts)" onClick={() => onOpenSettings({ kind: "collection", id: c.id })}>
                  <Icon name="settings" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="New request" onClick={() => onNewRequest(c.id, null)}>
                  <Icon name="add" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="New folder" onClick={() => onNewFolder(c.id)}>
                  <Icon name="create_new_folder" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Rename collection" onClick={() => setRenaming({ kind: "collection", id: c.id })}>
                  <Icon name="edit" className="text-body-sm" />
                </button>
                <button type="button" className={HOVER_BTN} title="Duplicate collection" onClick={() => onDuplicate("collection", c.id)}>
                  <Icon name="content_copy" className="text-body-sm" />
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
            {loose.length > 0 && <div className="space-y-0.5">{loose.map((r) => requestRow(c, r))}</div>}
            {c.requests.length === 0 && c.folders.length === 0 && (
              <button
                type="button"
                onClick={() => onNewRequest(c.id, null)}
                onDragOver={acceptInto}
                className="w-full text-left px-space-xs py-1 font-body-sm text-body-sm text-outline hover:text-primary"
              >
                {drag?.kind === "request" ? "Drop here" : "+ Add a request"}
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
      <div
        className="flex-1 overflow-y-auto p-space-xs space-y-space-xs"
        role="tree"
        aria-label="Collections"
        // Over a gap or an invalid spot: no target. Rows stop propagation when they accept the drag.
        onDragOver={() => {
          if (!drag) return;
          clearExpand();
          if (dropAt) setDropAt(null);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            clearExpand();
            setDropAt(null);
          }
        }}
        onDrop={(e) => {
          if (!drag) return;
          e.preventDefault();
          if (dropAt) performDrop(drag, dropAt);
          endDrag();
        }}
      >
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
