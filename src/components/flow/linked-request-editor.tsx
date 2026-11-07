"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";
import { RequestBuilder, type Draft } from "@/components/collections/request-builder";
import { ResponseViewer } from "@/components/collections/response-viewer";
import { TokenProvider } from "@/components/collections/template-field";
import { notifyRequestSent } from "@/lib/canvas-events";
import {
  createExample,
  deleteExample,
  fetchCollections,
  fetchExamples,
  fetchRequest,
  saveRequest,
  sendAdHoc,
} from "@/lib/collections/client";
import type { Collection, Example, SavedRequest, SendOutcome } from "@/lib/collections/schema";
import { stable } from "@/lib/collections/stable";
import { useEnvironment } from "@/lib/environment";
import { fetchVariables } from "@/lib/workflows/client";

type Props = {
  requestId: string;
  /** The dialog's top line. */
  title?: string;
  onClose: () => void;
  /** Called after each save (every save also dispatches REQUEST_SAVED_EVENT). */
  onSaved?: (request: SavedRequest) => void;
};

/** Window event (detail: the request id) after a saved request changes, so linked flow nodes refresh their copy. */
export const REQUEST_SAVED_EVENT = "reqora:request-saved";

const toDraft = (r: SavedRequest): Draft => ({ name: r.name, folderId: r.folderId, definition: r.definition });

/**
 * The Collections request editor in a dialog: edit a saved request (params, auth, headers, body, scripts, tests),
 * send it and save it without leaving the page — from a linked flow node or the sidebar's Saved Requests.
 */
export function LinkedRequestEditor({
  requestId,
  title = "Editing the linked Collections request — saving applies to every flow and run that uses it",
  onClose,
  onSaved,
}: Props) {
  const environment = useEnvironment();
  const [request, setRequest] = useState<SavedRequest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [collection, setCollection] = useState<Collection | undefined>();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<SendOutcome | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const [vars, setVars] = useState<{ env: string; names: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRequest(requestId)
      .then((r) => {
        if (cancelled) return;
        setRequest(r);
        setDraft(toDraft(r));
        return fetchCollections().then((list) => !cancelled && setCollection(list.find((c) => c.id === r.collectionId)));
      })
      .catch((e: Error) => !cancelled && setLoadError(e.message));
    fetchExamples(requestId)
      .then((list) => !cancelled && setExamples(list))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  useEffect(() => {
    let cancelled = false;
    fetchVariables(environment)
      .then((r) => !cancelled && setVars({ env: environment, names: r.data.map((v) => v.name) }))
      .catch(() => !cancelled && setVars({ env: environment, names: [] }));
    return () => {
      cancelled = true;
    };
  }, [environment]);

  const dirty = Boolean(draft && request && stable(draft) !== stable(toDraft(request)));

  const close = () => {
    if (dirty && !window.confirm("Discard unsaved changes to this request?")) return;
    onClose();
  };

  const save = () => {
    if (!draft || saving) return;
    setSaving(true);
    saveRequest(requestId, draft)
      .then((saved) => {
        setRequest(saved);
        setDraft(toDraft(saved));
        setNotice({ text: "Saved — Collections and every flow linked to this request use it now.", tone: "ok" });
        onSaved?.(saved);
        window.dispatchEvent(new CustomEvent(REQUEST_SAVED_EVENT, { detail: saved.id }));
      })
      .catch((e: Error) => setNotice({ text: `Save failed: ${e.message}`, tone: "error" }))
      .finally(() => setSaving(false));
  };

  const send = () => {
    if (!draft || sending) return;
    setSending(true);
    sendAdHoc(draft.definition, environment, {
      collectionId: request!.collectionId,
      folderId: draft.folderId,
      requestId,
      name: draft.name.trim() || undefined,
    })
      .then(setOutcome)
      .catch((e: Error) => setOutcome({ error: e.message, durationMs: 0 }))
      .finally(() => {
        setSending(false);
        notifyRequestSent();
      });
  };

  const saveExample = () => {
    if (!outcome || !("status" in outcome)) return;
    const name = window.prompt("Example name", `${outcome.status} ${outcome.statusText}`.trim());
    if (!name?.trim()) return;
    const { status, statusText, headers, body, size, durationMs } = outcome;
    createExample(requestId, name.trim(), { status, statusText, headers, body, size, durationMs })
      .then((ex) => {
        setExamples((list) => [ex, ...list]);
        setNotice({ text: `Saved example “${ex.name}”.`, tone: "ok" });
      })
      .catch((e: Error) => setNotice({ text: `Could not save example: ${e.message}`, tone: "error" }));
  };

  // Esc closes (asking first when there are unsaved edits); Ctrl/⌘+S saves without closing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        save();
      } else if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  // Portalled to <body>: the inspector's backdrop-filter would otherwise confine a fixed overlay to the panel.
  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm p-space-lg"
      role="dialog"
      aria-modal="true"
      aria-label="Edit linked request"
      data-testid="linked-request-editor"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="w-full max-w-6xl h-full max-h-[56rem] flex flex-col rounded-xl bg-surface shadow-2xl overflow-hidden">
        <div className="h-11 shrink-0 px-space-sm flex items-center gap-space-xs bg-surface-container-lowest">
          <Icon name="link" className="text-primary text-body-md" />
          <span className="font-label-md text-label-md text-on-surface-variant flex-1 truncate">
            {title}
          </span>
          <a
            className="font-label-sm text-label-sm text-primary hover:underline flex items-center gap-1"
            href={`/collections?request=${requestId}`}
            target="_blank"
            rel="noreferrer"
            title="Open the Collections page in a new tab"
          >
            Open in Collections <Icon name="open_in_new" className="text-body-sm" />
          </a>
          <button
            type="button"
            className="p-1 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
            title="Close (Esc)"
            aria-label="Close"
            onClick={close}
          >
            <Icon name="close" className="text-body-md" />
          </button>
        </div>

        {loadError ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-space-xs p-space-xl text-center">
            <Icon name="link_off" className="text-display-lg text-outline" />
            <p className="font-headline-sm text-headline-sm text-on-surface">Couldn&apos;t load the request</p>
            <p className="font-body-sm text-body-sm text-on-surface-variant">{loadError}</p>
          </div>
        ) : !draft ? (
          <div className="flex-1 flex items-center justify-center font-body-sm text-body-sm text-on-surface-variant gap-1">
            <Icon name="progress_activity" className="text-body-md animate-spin" /> Loading request…
          </div>
        ) : (
          <TokenProvider>
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <RequestBuilder
                requestId={requestId}
                draft={draft}
                update={(fn) => setDraft((d) => (d ? fn(d) : d))}
                collection={collection}
                environment={environment}
                variableNames={vars?.env === environment ? vars.names : []}
                dirty={dirty}
                saving={saving}
                sending={sending}
                onSave={save}
                onSend={send}
                onOpenScope={(source) => window.open(`/collections?${source.scope}=${encodeURIComponent(source.id)}`, "_blank", "noreferrer")}
                showAddToFlow={false}
              />
              {notice && (
                <div
                  role={notice.tone === "error" ? "alert" : "status"}
                  className={`px-space-sm py-1 font-body-sm text-body-sm flex items-center gap-1 ${
                    notice.tone === "error" ? "bg-error-container/40 text-on-error-container" : "bg-primary/10 text-primary"
                  }`}
                >
                  <Icon name={notice.tone === "error" ? "error" : "check_circle"} className="text-body-sm" />
                  <span className="flex-1">{notice.text}</span>
                  <button type="button" title="Dismiss" onClick={() => setNotice(null)} className="text-outline hover:text-on-surface">
                    <Icon name="close" className="text-body-sm" />
                  </button>
                </div>
              )}
              <ResponseViewer
                outcome={outcome}
                sending={sending}
                examples={examples}
                canSaveExample
                onSaveExample={saveExample}
                onDeleteExample={(id) =>
                  deleteExample(id)
                    .then(() => setExamples((list) => list.filter((e) => e.id !== id)))
                    .catch((e: Error) => setNotice({ text: e.message, tone: "error" }))
                }
              />
            </div>
          </TokenProvider>
        )}
      </div>
    </div>,
    document.body,
  );
}
