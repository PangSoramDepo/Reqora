"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import {
  createCollection,
  createExample,
  createFolder,
  createRequest,
  deleteCollection,
  deleteExample,
  deleteFolder,
  deleteRequest,
  duplicateCollection,
  duplicateFolder,
  duplicateRequest,
  fetchCollections,
  fetchExamples,
  fetchRequest,
  moveFolder,
  moveRequest,
  renameFolder,
  saveRequest,
  sendAdHoc,
  updateCollection,
  updateFolderSettings,
} from "@/lib/collections/client";
import { subtreeIds } from "@/lib/collections/folders";
import { stable } from "@/lib/collections/stable";
import type { Collection, Example, SavedRequest, ScopeSettings, SendOutcome } from "@/lib/collections/schema";
import { notifyRequestSent } from "@/lib/canvas-events";
import { useEnvironment } from "@/lib/environment";
import { fetchVariables } from "@/lib/workflows/client";
import type { Environment } from "@/lib/workflows/schema";
import type { InheritSource } from "./auth-panel";
import { Explorer, type NodeKind, type Renaming, type RequestTarget, type ScopeRef } from "./explorer";
import { ImportDialog, type ImportFormat } from "./import-dialog";
import { RequestBuilder, type Draft } from "./request-builder";
import { ResponseViewer } from "./response-viewer";
import { ScopeSettingsPanel } from "./scope-settings";
import { TokenProvider } from "./template-field";

const toDraft = (r: SavedRequest): Draft => ({ name: r.name, folderId: r.folderId, definition: r.definition });

/** Optimistically applies a request move to the explorer tree (the server renumbers positions the same way). */
function applyRequestMove(collections: Collection[], id: string, t: RequestTarget): Collection[] {
  const moving = collections.flatMap((c) => c.requests).find((r) => r.id === id);
  if (!moving) return collections;
  const moved = { ...moving, folderId: t.folderId };
  return collections.map((c) => {
    let requests = c.requests.filter((r) => r.id !== id);
    if (c.id === t.collectionId) {
      const container = requests.filter((r) => r.folderId === t.folderId);
      const before = container[t.index];
      const at = before ? requests.indexOf(before) : container.length ? requests.indexOf(container[container.length - 1]) + 1 : requests.length;
      requests = [...requests.slice(0, at), moved, ...requests.slice(at)];
    }
    return requests.length === c.requests.length && requests.every((r, i) => r === c.requests[i]) ? c : { ...c, requests };
  });
}

/** Optimistically puts a folder at `index` among `parentId`'s sub-folders (sibling order is array order). */
function applyFolderMove(collections: Collection[], id: string, index: number, parentId: string | null): Collection[] {
  return collections.map((c) => {
    const folder = c.folders.find((f) => f.id === id);
    if (!folder) return c;
    const moved = { ...folder, parentId };
    const folders = c.folders.filter((f) => f.id !== id);
    const siblings = folders.filter((f) => f.parentId === parentId);
    const before = siblings[index];
    const at = before ? folders.indexOf(before) : siblings.length ? folders.indexOf(siblings[siblings.length - 1]) + 1 : folders.length;
    folders.splice(at, 0, moved);
    return { ...c, folders };
  });
}

type Target = { request: string } | ScopeRef | null;

export function CollectionsWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const selectedId = params.get("request");
  const folderParam = params.get("folder");
  const collectionParam = params.get("collection");
  const selectedScope: ScopeRef | null = selectedId
    ? null
    : folderParam
      ? { kind: "folder", id: folderParam }
      : collectionParam
        ? { kind: "collection", id: collectionParam }
        : null;
  const environment = useEnvironment();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [importing, setImporting] = useState<ImportFormat | null>(null);

  // Per-request state is tagged with the request id it belongs to, so switching requests needs no reset.
  const [loaded, setLoaded] = useState<{ id: string; request?: SavedRequest; error?: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; draft: Draft } | null>(null);
  const [result, setResult] = useState<{ id: string; outcome: SendOutcome } | null>(null);
  const [examples, setExamples] = useState<{ id: string; list: Example[] } | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: "error" | "ok" } | null>(null);
  const [vars, setVars] = useState<{ env: Environment; names: string[] } | null>(null);
  // Collection / folder settings being edited, tagged with "kind:id".
  const [scopeEdit, setScopeEdit] = useState<{ key: string; settings: ScopeSettings } | null>(null);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [scopeError, setScopeError] = useState<{ key: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCollections()
      .then((list) => {
        if (cancelled) return;
        setCollections(list);
        setListError(null);
      })
      .catch((e: Error) => !cancelled && setListError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    fetchRequest(selectedId)
      // Ignore a response older than what a concurrent save (e.g. a rename) already stored.
      .then(
        (request) =>
          !cancelled &&
          setLoaded((l) => (l?.id === selectedId && l.request && l.request.updatedAt > request.updatedAt ? l : { id: selectedId, request })),
      )
      .catch((e: Error) => !cancelled && setLoaded({ id: selectedId, error: e.message }));
    fetchExamples(selectedId)
      .then((list) => !cancelled && setExamples({ id: selectedId, list }))
      .catch(() => !cancelled && setExamples({ id: selectedId, list: [] }));
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    let cancelled = false;
    fetchVariables(environment)
      .then((r) => !cancelled && setVars({ env: environment, names: r.data.map((v) => v.name) }))
      .catch(() => !cancelled && setVars({ env: environment, names: [] }));
    return () => {
      cancelled = true;
    };
  }, [environment]);

  const current = selectedId && loaded?.id === selectedId ? loaded : null;
  const base = current?.request ? toDraft(current.request) : null;
  const draft = selectedId && edit?.id === selectedId ? edit.draft : base;
  const dirty = Boolean(draft && base && stable(draft) !== stable(base));
  const outcome = selectedId && result?.id === selectedId ? result.outcome : null;
  const exampleList = selectedId && examples?.id === selectedId ? examples.list : [];
  const collection = collections.find((c) => c.id === current?.request?.collectionId);
  const sending = sendingId !== null && sendingId === selectedId;
  const currentNotice = notice?.id === selectedId ? notice : null;

  const scopeKey = selectedScope ? `${selectedScope.kind}:${selectedScope.id}` : null;
  const scopeCollection = selectedScope
    ? collections.find((c) => (selectedScope.kind === "collection" ? c.id === selectedScope.id : c.folders.some((f) => f.id === selectedScope.id)))
    : undefined;
  const scopeFolder = selectedScope?.kind === "folder" ? scopeCollection?.folders.find((f) => f.id === selectedScope.id) : undefined;
  const scopeBase = selectedScope?.kind === "folder" ? scopeFolder?.settings : scopeCollection?.settings;
  const scopeDraft = scopeKey && scopeEdit?.key === scopeKey ? scopeEdit.settings : scopeBase;
  const scopeDirty = Boolean(scopeDraft && scopeBase && stable(scopeDraft) !== stable(scopeBase));

  const refresh = () =>
    fetchCollections()
      .then((list) => {
        setCollections(list);
        setListError(null);
      })
      .catch((e: Error) => setListError(e.message));

  const fail = (e: Error) => setListError(e.message);

  const update = (fn: (d: Draft) => Draft) => {
    if (!selectedId) return;
    setEdit((e) => {
      const start = e?.id === selectedId ? e.draft : base;
      return start ? { id: selectedId, draft: fn(start) } : e;
    });
  };

  /** Opens a request, a collection's or folder's settings, or nothing; confirms before dropping unsaved edits. */
  const go = (target: Target, { force = false } = {}) => {
    const same = !target
      ? !selectedId && !selectedScope
      : "request" in target
        ? target.request === selectedId
        : selectedScope?.kind === target.kind && selectedScope.id === target.id;
    if (same) return true;
    if (!force && dirty && !window.confirm("Discard unsaved changes to this request?")) return false;
    if (!force && scopeDirty && !window.confirm("Discard unsaved changes to these settings?")) return false;
    if (dirty) setEdit(null);
    if (scopeDirty) setScopeEdit(null);
    const query = !target ? "" : "request" in target ? `?request=${encodeURIComponent(target.request)}` : `?${target.kind}=${encodeURIComponent(target.id)}`;
    router.push(`/collections${query}`, { scroll: false });
    return true;
  };
  const navigate = (id: string | null, options?: { force?: boolean }) => go(id ? { request: id } : null, options);
  const openScope = (source: InheritSource | ScopeRef) => go("scope" in source ? { kind: source.scope, id: source.id } : source);

  const updateScope = (fn: (s: ScopeSettings) => ScopeSettings) => {
    if (!scopeKey) return;
    setScopeEdit((e) => {
      const start = e?.key === scopeKey ? e.settings : scopeBase;
      return start ? { key: scopeKey, settings: fn(start) } : e;
    });
  };

  const saveScope = () => {
    if (!selectedScope || !scopeKey || !scopeDraft || scopeSaving) return;
    const scope = selectedScope;
    const key = scopeKey;
    const settings = scopeDraft;
    setScopeSaving(true);
    const op =
      scope.kind === "collection"
        ? updateCollection(scope.id, { settings }).then((c) => c.settings)
        : updateFolderSettings(scope.id, settings).then((f) => f.settings);
    op.then((saved) => {
      setCollections((cs) =>
        cs.map((c) =>
          scope.kind === "collection"
            ? c.id === scope.id
              ? { ...c, settings: saved }
              : c
            : { ...c, folders: c.folders.map((f) => (f.id === scope.id ? { ...f, settings: saved } : f)) },
        ),
      );
      setScopeEdit((e) => (e?.key === key ? null : e));
      setScopeError(null);
      void refresh();
    })
      .catch((e: Error) => setScopeError({ key, text: `Save failed: ${e.message}` }))
      .finally(() => setScopeSaving(false));
  };

  const moveRequestTo = (id: string, target: RequestTarget) => {
    const from = collections.find((c) => c.requests.some((r) => r.id === id));
    const request = from?.requests.find((r) => r.id === id);
    if (from && request && from.id === target.collectionId && request.folderId === target.folderId) {
      const index = from.requests.filter((r) => r.folderId === request.folderId).findIndex((r) => r.id === id);
      if (index === target.index) return;
    }
    setCollections((cs) => applyRequestMove(cs, id, target));
    moveRequest(id, target)
      .then((moved) => {
        // Keep unsaved edits of the open request, but at its new location so a later Save doesn't move it back.
        setLoaded((l) => (l?.id === id && l.request ? { id, request: moved } : l));
        setEdit((e) => (e?.id === id ? { id, draft: { ...e.draft, folderId: moved.folderId } } : e));
        return refresh();
      })
      .catch((e: Error) => {
        fail(e);
        void refresh();
      });
  };

  const moveFolderTo = (id: string, index: number, parentId: string | null) => {
    const folder = collections.flatMap((c) => c.folders).find((f) => f.id === id);
    if (!folder) return;
    const from = collections.find((c) => c.id === folder.collectionId);
    const siblingIndex = from?.folders.filter((f) => f.parentId === parentId).findIndex((f) => f.id === id);
    if (folder.parentId === parentId && siblingIndex === index) return;
    setCollections((cs) => applyFolderMove(cs, id, index, parentId));
    moveFolder(id, index, parentId)
      .then(refresh)
      .catch((e: Error) => {
        fail(e);
        void refresh();
      });
  };

  const save = () => {
    if (!selectedId || !draft || saving) return;
    const id = selectedId;
    setSaving(true);
    saveRequest(id, draft)
      .then((saved) => {
        setLoaded({ id, request: saved });
        setEdit(null);
        setNotice(null);
        void refresh();
      })
      .catch((e: Error) => setNotice({ id, text: `Save failed: ${e.message}`, tone: "error" }))
      .finally(() => setSaving(false));
  };

  const send = () => {
    if (!selectedId || !draft || sendingId) return;
    const id = selectedId;
    setSendingId(id);
    // The location makes the collection's and folder's auth, headers and scripts apply (folder as currently edited).
    sendAdHoc(
      draft.definition,
      environment,
      collection ? { collectionId: collection.id, folderId: draft.folderId, requestId: id, name: draft.name.trim() || undefined } : undefined,
    )
      .then((o) => setResult({ id, outcome: o }))
      .catch((e: Error) => setResult({ id, outcome: { error: e.message, durationMs: 0 } }))
      .finally(() => {
        setSendingId(null);
        notifyRequestSent();
      });
  };

  const saveExample = () => {
    if (!selectedId || !outcome || !("status" in outcome)) return;
    const id = selectedId;
    const name = window.prompt("Example name", `${outcome.status} ${outcome.statusText}`.trim());
    if (!name?.trim()) return;
    const { status, statusText, headers, body, size, durationMs } = outcome;
    createExample(id, name.trim(), { status, statusText, headers, body, size, durationMs })
      .then((ex) => {
        setExamples((cur) => ({ id, list: [ex, ...(cur?.id === id ? cur.list : [])] }));
        setNotice({ id, text: `Saved example “${ex.name}”.`, tone: "ok" });
      })
      .catch((e: Error) => setNotice({ id, text: `Could not save example: ${e.message}`, tone: "error" }));
  };

  const removeExample = (exampleId: string) => {
    if (!selectedId) return;
    const id = selectedId;
    deleteExample(exampleId)
      .then(() => setExamples((cur) => (cur?.id === id ? { id, list: cur.list.filter((e) => e.id !== exampleId) } : cur)))
      .catch((e: Error) => setNotice({ id, text: e.message, tone: "error" }));
  };

  // Ctrl/⌘+S saves; unsaved edits warn before leaving the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (selectedScope) saveScope();
        else save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const unsaved = dirty || scopeDirty;
  useEffect(() => {
    if (!unsaved) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [unsaved]);

  const newCollection = () =>
    createCollection("New Collection")
      .then((c) => refresh().then(() => setRenaming({ kind: "collection", id: c.id })))
      .catch(fail);
  const newFolder = (collectionId: string, parentId: string | null = null) =>
    createFolder(collectionId, "New Folder", parentId)
      .then((f) => refresh().then(() => setRenaming({ kind: "folder", id: f.id })))
      .catch(fail);
  const newRequest = (collectionId: string, folderId: string | null) =>
    createRequest(collectionId, { name: "New Request", folderId })
      .then((r) =>
        refresh().then(() => {
          if (navigate(r.id)) setRenaming({ kind: "request", id: r.id });
        }),
      )
      .catch(fail);

  const rename = (kind: NodeKind, id: string, name: string) => {
    if (kind === "request") {
      // Saves only the name, so other unsaved edits of an open request stay unsaved (and keep the new name).
      fetchRequest(id)
        .then((r) => saveRequest(id, { ...toDraft(r), name }))
        .then((saved) => {
          setLoaded((l) => (l?.id === id ? { id, request: saved } : l));
          setEdit((e) => (e?.id === id ? { id, draft: { ...e.draft, name } } : e));
          return refresh();
        })
        .catch(fail);
    } else if (kind === "folder") {
      renameFolder(id, name).then(refresh).catch(fail);
    } else {
      updateCollection(id, { name }).then(refresh).catch(fail);
    }
  };

  /**
   * Copies the saved item server-side, then opens the copy. Unsaved edits of an open request are not part of
   * the copy; opening the copy asks before discarding them, as any navigation does.
   */
  const duplicate = (kind: NodeKind, id: string) => {
    if (kind === "request") {
      duplicateRequest(id)
        .then((r) => refresh().then(() => navigate(r.id)))
        .catch(fail);
    } else {
      const op = kind === "folder" ? duplicateFolder(id) : duplicateCollection(id);
      op.then((copy) => refresh().then(() => go({ kind, id: copy.id }))).catch(fail);
    }
  };

  const remove = (kind: NodeKind, id: string, name: string) => {
    // A folder takes its sub-folders with it.
    const removedFolders = kind === "folder" ? subtreeIds(collections.flatMap((c) => c.folders), id) : new Set<string>();
    const containsSelected =
      kind === "request"
        ? id === selectedId
        : kind === "folder"
          ? collections.some((c) => c.requests.some((r) => r.folderId !== null && removedFolders.has(r.folderId) && r.id === selectedId))
          : collections.some((c) => c.id === id && c.requests.some((r) => r.id === selectedId));
    const what =
      kind === "request"
        ? `request “${name}”`
        : kind === "folder"
          ? `folder “${name}” with its sub-folders and all requests in them`
          : `collection “${name}” with all its folders and requests`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    const op = kind === "request" ? deleteRequest(id) : kind === "folder" ? deleteFolder(id) : deleteCollection(id);
    const containsScope =
      selectedScope !== null &&
      (kind === "folder"
        ? selectedScope.kind === "folder" && removedFolders.has(selectedScope.id)
        : kind === selectedScope.kind
          ? id === selectedScope.id
          : kind === "collection" && selectedScope.kind === "folder" && collections.some((c) => c.id === id && c.folders.some((f) => f.id === selectedScope.id)));
    op.then(() => {
      if (containsSelected || containsScope) {
        setEdit(null);
        setScopeEdit(null);
        go(null, { force: true });
      }
      return refresh();
    }).catch(fail);
  };

  return (
    <TokenProvider>
      <div className="w-full flex flex-col xl:flex-row h-[calc(100vh-3.5rem-2.5rem)] overflow-hidden">
        <Explorer
          collections={collections}
          loading={loading}
          error={listError}
          selectedId={selectedId}
          selectedDirty={dirty}
          selectedScope={selectedScope}
          renaming={renaming}
          setRenaming={setRenaming}
          onSelect={(id) => navigate(id)}
          onOpenSettings={openScope}
          onMoveRequest={moveRequestTo}
          onMoveFolder={moveFolderTo}
          onNewCollection={newCollection}
          onNewFolder={newFolder}
          onNewRequest={newRequest}
          onRename={rename}
          onDelete={remove}
          onDuplicate={duplicate}
          onImport={setImporting}
        />
        <section className="flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
          {selectedScope && scopeCollection && scopeDraft ? (
            <ScopeSettingsPanel
              key={scopeKey}
              collection={scopeCollection}
              folder={scopeFolder}
              settings={scopeDraft}
              update={updateScope}
              dirty={scopeDirty}
              saving={scopeSaving}
              error={scopeError?.key === scopeKey ? scopeError.text : null}
              onSave={saveScope}
              onOpenSource={openScope}
              variableNames={vars?.env === environment ? vars.names : []}
            />
          ) : selectedScope ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-space-sm p-space-xl text-center">
              {loading ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1">
                  <Icon name="progress_activity" className="text-body-md animate-spin" /> Loading settings…
                </p>
              ) : (
                <>
                  <Icon name="link_off" className="text-display-lg text-outline" />
                  <p className="font-headline-sm text-headline-sm text-on-surface">{selectedScope.kind === "folder" ? "Folder" : "Collection"} not found</p>
                  <button type="button" onClick={() => go(null, { force: true })} className="text-primary font-label-md text-label-md hover:underline">
                    Back to collections
                  </button>
                </>
              )}
            </div>
          ) : selectedId && draft && current?.request ? (
            <>
              <RequestBuilder
                key={selectedId}
                requestId={selectedId}
                draft={draft}
                update={update}
                collection={collection}
                environment={environment}
                variableNames={vars?.env === environment ? vars.names : []}
                dirty={dirty}
                saving={saving}
                sending={sending}
                onSave={save}
                onSend={send}
                onOpenScope={openScope}
              />
              {currentNotice && (
                <div
                  role={currentNotice.tone === "error" ? "alert" : "status"}
                  className={`px-space-sm py-1 font-body-sm text-body-sm flex items-center gap-1 ${
                    currentNotice.tone === "error" ? "bg-error-container/40 text-on-error-container" : "bg-primary/10 text-primary"
                  }`}
                >
                  <Icon name={currentNotice.tone === "error" ? "error" : "check_circle"} className="text-body-sm" />
                  <span className="flex-1">{currentNotice.text}</span>
                  <button type="button" title="Dismiss" onClick={() => setNotice(null)} className="text-outline hover:text-on-surface">
                    <Icon name="close" className="text-body-sm" />
                  </button>
                </div>
              )}
              <ResponseViewer
                key={`${selectedId}-viewer`}
                outcome={outcome}
                sending={sending}
                examples={exampleList}
                canSaveExample
                onSaveExample={saveExample}
                onDeleteExample={removeExample}
              />
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-space-sm p-space-xl text-center">
              {selectedId && current?.error ? (
                <>
                  <Icon name="link_off" className="text-display-lg text-outline" />
                  <p className="font-headline-sm text-headline-sm text-on-surface">Request not found</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">{current.error}</p>
                  <button type="button" onClick={() => navigate(null, { force: true })} className="text-primary font-label-md text-label-md hover:underline">
                    Back to collections
                  </button>
                </>
              ) : selectedId ? (
                <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1">
                  <Icon name="progress_activity" className="text-body-md animate-spin" /> Loading request…
                </p>
              ) : (
                <>
                  <Icon name="http" className="text-display-lg text-outline" />
                  <p className="font-headline-sm text-headline-sm text-on-surface">No request selected</p>
                  <p className="font-body-sm text-body-sm text-on-surface-variant max-w-md">
                    {collections.length
                      ? "Pick a request in the explorer, or hover a collection or folder and press + to create one. The gear opens its shared auth, headers and scripts."
                      : "Create a collection, or import a cURL command or OpenAPI spec, to start building requests."}
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
      {importing && (
        <ImportDialog
          initialFormat={importing}
          collections={collections}
          onClose={() => setImporting(null)}
          onImported={(c) => {
            setImporting(null);
            void refresh().then(() => {
              const newest = c.requests[c.requests.length - 1];
              if (newest) navigate(newest.id);
            });
          }}
        />
      )}
    </TokenProvider>
  );
}
