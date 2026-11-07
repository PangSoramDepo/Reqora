"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { fetchCollections } from "@/lib/collections/client";
import { flattenTree, subtreeIds } from "@/lib/collections/folders";
import type { Collection, RequestSummary } from "@/lib/collections/schema";
import { ADD_REQUEST_EVENT, REQUEST_DRAG_MIME } from "@/lib/workflows/defaults";

const METHOD_TONE: Record<string, string> = {
  GET: "text-secondary",
  POST: "text-primary",
  PUT: "text-tertiary",
  PATCH: "text-tertiary",
  DELETE: "text-error",
};

function RequestRow({ request }: { request: RequestSummary }) {
  return (
    <div
      draggable
      title={`${request.method} ${request.url}\nDrag onto the canvas, or double-click to add`}
      onDragStart={(e) => {
        e.dataTransfer.setData(REQUEST_DRAG_MIME, request.id);
        e.dataTransfer.effectAllowed = "copy";
      }}
      onDoubleClick={() => window.dispatchEvent(new CustomEvent(ADD_REQUEST_EVENT, { detail: request.id }))}
      className="flex items-center gap-space-xs px-space-xs py-1 rounded hover:bg-surface-container-high cursor-grab select-none"
    >
      <span className={`font-label-sm text-label-sm font-semibold w-11 shrink-0 ${METHOD_TONE[request.method] ?? "text-outline"}`}>
        {request.method}
      </span>
      <span className="font-body-sm text-body-sm text-on-surface truncate">{request.name}</span>
    </div>
  );
}

/**
 * Saved requests from Collections, draggable onto the Flow Canvas where they become HTTP nodes with the
 * collection's and folder's auth and headers applied.
 */
export function SavedRequests({ query }: { query: string }) {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchCollections()
      .then((data) => !cancelled && setCollections(data))
      .catch(() => !cancelled && setCollections([]));
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // Pick up requests created on the Collections page when coming back to this tab.
  useEffect(() => {
    const refresh = () => setReloadKey((k) => k + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const q = query.trim().toLowerCase();
  const matches = (r: RequestSummary) => !q || `${r.method} ${r.name} ${r.url}`.toLowerCase().includes(q);

  return (
    <div className="px-space-sm pb-space-sm">
      <div className="flex items-center justify-between px-space-xs mb-space-xs">
        <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Saved Requests</span>
        <button
          className="p-0.5 rounded text-outline hover:text-on-surface"
          onClick={() => setReloadKey((k) => k + 1)}
          title="Refresh"
          type="button"
        >
          <Icon name="refresh" className="text-body-md" />
        </button>
      </div>

      {collections === null && <div className="px-space-xs font-body-sm text-body-sm text-outline">Loading…</div>}
      {collections?.length === 0 && (
        <Link href="/collections" className="block px-space-xs font-body-sm text-body-sm text-primary hover:underline">
          Create requests in Collections →
        </Link>
      )}

      <div className="space-y-space-xxs">
        {collections?.map((collection) => {
          const rootRequests = collection.requests.filter((r) => r.folderId === null && matches(r));
          // Tree order; a folder shows when it or a sub-folder holds a matching request.
          const hits = collection.requests.filter((r) => r.folderId !== null && matches(r));
          const folders = flattenTree(collection.folders)
            .map(({ folder, depth }) => ({ folder, depth, requests: hits.filter((r) => r.folderId === folder.id) }))
            .filter(({ folder }) => {
              const inside = subtreeIds(collection.folders, folder.id);
              return hits.some((r) => inside.has(r.folderId!));
            });
          if (q && rootRequests.length === 0 && folders.length === 0) return null;
          // Collapsed by default; a filter expands everything that matches.
          const expanded = q ? true : (open[collection.id] ?? false);
          return (
            <div key={collection.id} className="rounded bg-surface-container/60">
              <button
                aria-expanded={expanded}
                className="w-full flex items-center gap-space-xxs px-space-xs py-1 text-left"
                onClick={() => setOpen((o) => ({ ...o, [collection.id]: !expanded }))}
                type="button"
              >
                <Icon name={expanded ? "arrow_drop_down" : "arrow_right"} className="text-outline text-body-md" />
                <Icon name="folder_data" className="text-primary-fixed-dim text-body-md" />
                <span className="font-body-sm text-body-sm text-on-surface truncate flex-1">{collection.name}</span>
                <span className="font-label-sm text-label-sm text-outline">{collection.requests.length}</span>
              </button>
              {expanded && (
                <div className="pl-space-sm pr-space-xxs pb-space-xxs">
                  {folders.map(({ folder, depth, requests }) => (
                    <div key={folder.id} style={{ paddingLeft: `${depth * 0.75}rem` }}>
                      <div className="flex items-center gap-1 px-space-xs py-0.5 font-body-sm text-body-sm text-on-surface-variant">
                        <Icon name="folder" className="text-tertiary-fixed-dim text-body-sm" />
                        <span className="truncate">{folder.name}</span>
                      </div>
                      <div className="pl-space-sm">
                        {requests.map((r) => (
                          <RequestRow key={r.id} request={r} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {rootRequests.map((r) => (
                    <RequestRow key={r.id} request={r} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
