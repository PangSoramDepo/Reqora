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
  fetchCollections,
  fetchExamples,
  fetchRequest,
  renameFolder,
  saveRequest,
  sendAdHoc,
  updateCollection,
} from "@/lib/collections/client";
import type { Collection, Example, SavedRequest, SendOutcome } from "@/lib/collections/schema";
import { useEnvironment } from "@/lib/environment";
import { fetchVariables } from "@/lib/workflows/client";
import type { Environment } from "@/lib/workflows/schema";
import { Explorer, type NodeKind, type Renaming } from "./explorer";
import { ImportDialog } from "./import-dialog";
import { RequestBuilder, type Draft } from "./request-builder";
import { ResponseViewer } from "./response-viewer";
import { TokenProvider } from "./template-field";

/** Key-order independent JSON, so "dirty" survives the server re-serialising a definition. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const toDraft = (r: SavedRequest): Draft => ({ name: r.name, folderId: r.folderId, definition: r.definition });

export function CollectionsWorkspace() {
  const router = useRouter();
  const selectedId = useSearchParams().get("request");
  const environment = useEnvironment();

  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [importing, setImporting] = useState<"curl" | "openapi" | null>(null);

  // Per-request state is tagged with the request id it belongs to, so switching requests needs no reset.
  const [loaded, setLoaded] = useState<{ id: string; request?: SavedRequest; error?: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; draft: Draft } | null>(null);
  const [result, setResult] = useState<{ id: string; outcome: SendOutcome } | null>(null);
  const [examples, setExamples] = useState<{ id: string; list: Example[] } | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: "error" | "ok" } | null>(null);
  const [vars, setVars] = useState<{ env: Environment; names: string[] } | null>(null);

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

  const refresh = () =>
    fetchCollections()
      .then((list) => {
        setCollections(list);
        setListError(null);
      })
      .catch((e: Error) => setListError(e.message));

  const update = (fn: (d: Draft) => Draft) => {
    if (!selectedId) return;
    setEdit((e) => {
      const start = e?.id === selectedId ? e.draft : base;
      return start ? { id: selectedId, draft: fn(start) } : e;
    });
  };

  const navigate = (id: string | null, { force = false } = {}) => {
    if (!force && dirty && id !== selectedId && !window.confirm("Discard unsaved changes to this request?")) return false;
    if (dirty && id !== selectedId) setEdit(null);
    router.push(id ? `/collections?request=${encodeURIComponent(id)}` : "/collections", { scroll: false });
    return true;
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
    sendAdHoc(draft.definition, environment)
      .then((o) => setResult({ id, outcome: o }))
      .catch((e: Error) => setResult({ id, outcome: { error: e.message, durationMs: 0 } }))
      .finally(() => setSendingId(null));
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
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const fail = (e: Error) => setListError(e.message);

  const newCollection = () =>
    createCollection("New Collection")
      .then((c) => refresh().then(() => setRenaming({ kind: "collection", id: c.id })))
      .catch(fail);
  const newFolder = (collectionId: string) =>
    createFolder(collectionId, "New Folder")
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

  const remove = (kind: NodeKind, id: string, name: string) => {
    const containsSelected =
      kind === "request"
        ? id === selectedId
        : kind === "folder"
          ? collections.some((c) => c.requests.some((r) => r.folderId === id && r.id === selectedId))
          : collections.some((c) => c.id === id && c.requests.some((r) => r.id === selectedId));
    const what =
      kind === "request" ? `request “${name}”` : kind === "folder" ? `folder “${name}” and all requests in it` : `collection “${name}” with all its folders and requests`;
    if (!window.confirm(`Delete ${what}? This cannot be undone.`)) return;
    const op = kind === "request" ? deleteRequest(id) : kind === "folder" ? deleteFolder(id) : deleteCollection(id);
    op.then(() => {
      if (containsSelected) {
        setEdit(null);
        navigate(null, { force: true });
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
          renaming={renaming}
          setRenaming={setRenaming}
          onSelect={(id) => navigate(id)}
          onNewCollection={newCollection}
          onNewFolder={newFolder}
          onNewRequest={newRequest}
          onRename={rename}
          onDelete={remove}
          onImport={setImporting}
        />
        <section className="flex-1 flex flex-col min-w-0 bg-surface overflow-hidden">
          {selectedId && draft && current?.request ? (
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
                      ? "Pick a request in the explorer, or hover a collection or folder and press + to create one."
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
