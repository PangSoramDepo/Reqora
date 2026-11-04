"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { importCollection } from "@/lib/collections/client";
import type { Collection } from "@/lib/collections/schema";
import { GHOST_BUTTON, SELECT } from "./ui";

export type ImportFormat = "reqora" | "curl" | "openapi";
type Format = ImportFormat;

const TAB_LABEL: Record<Format, string> = {
  reqora: "Reqora collection",
  curl: "cURL command",
  openapi: "OpenAPI (JSON / YAML)",
};

type Props = {
  initialFormat: Format;
  collections: Collection[];
  onClose: () => void;
  onImported: (collection: Collection) => void;
};

const PLACEHOLDER: Record<Format, string> = {
  reqora: `{
  "reqora": "collection",
  "version": 1,
  "collection": { "name": "My API", "folders": [], "requests": [] }
}`,
  curl: `curl -X POST https://api.example.com/v1/orders \\
  -H 'Content-Type: application/json' \\
  -H 'Authorization: Bearer {{env.API_TOKEN}}' \\
  -d '{"sku":"A-1","qty":2}'`,
  openapi: `openapi: 3.0.3
info: { title: My API }
servers: [{ url: https://api.example.com/v1 }]
paths:
  /orders:
    post:
      tags: [orders]
      summary: Create order`,
};

export function ImportDialog({ initialFormat, collections, onClose, onImported }: Props) {
  const [format, setFormat] = useState<Format>(initialFormat);
  const [text, setText] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    setBusy(true);
    setError(null);
    importCollection(format, text, format === "curl" && target ? target : undefined)
      .then(onImported)
      .catch((e: Error) => {
        setError(e.message);
        setBusy(false);
      });
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm p-space-lg"
      role="dialog"
      aria-modal="true"
      aria-label="Import a collection, cURL or OpenAPI"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div className="w-full max-w-2xl bg-surface-container-low rounded-xl shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-space-md py-space-sm bg-surface-container-lowest/80 rounded-t-xl">
          <div className="flex items-center gap-space-xs">
            <Icon name="publish" className="text-primary text-headline-sm" />
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Import</span>
          </div>
          <button type="button" onClick={onClose} className="p-1 rounded text-on-surface-variant hover:text-on-surface" title="Close">
            <Icon name="close" className="text-body-lg" />
          </button>
        </div>
        <div className="p-space-md flex flex-col gap-space-sm overflow-auto">
          <div className="flex items-center gap-space-xxs" role="tablist">
            {(["reqora", "curl", "openapi"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={format === f}
                onClick={() => setFormat(f)}
                className={`px-space-sm py-1.5 rounded font-label-md text-label-md ${
                  format === f ? "bg-surface-container-high text-primary font-semibold" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {TAB_LABEL[f]}
              </button>
            ))}
          </div>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {format === "reqora"
              ? "Load a .reqora.json file exported from Reqora (the download icon on a collection). It becomes a new collection with its folders, requests, auth, headers, scripts, tests and examples. Environment variables and secrets are not part of the file."
              : format === "curl"
              ? "Paste a curl command. Method, headers, body, basic auth (-u) and query params are imported."
              : "Paste an OpenAPI 3 / Swagger 2 document. A collection is created from info.title with one folder per tag and one request per operation; {param} path parameters become {{param}}."}
          </p>
          {format !== "curl" && (
            <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <span>…or load a file:</span>
              <input
                type="file"
                accept={format === "reqora" ? ".json,application/json" : ".json,.yaml,.yml,application/json,text/yaml"}
                className="font-body-sm text-body-sm text-on-surface-variant file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-surface-container-high file:text-on-surface"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void file.text().then(setText);
                }}
              />
            </label>
          )}
          <textarea
            aria-label={format === "curl" ? "cURL command" : format === "reqora" ? "Reqora collection JSON" : "OpenAPI document"}
            className="w-full h-64 bg-surface-container-lowest rounded p-space-sm font-code-block text-code-block text-on-surface placeholder:text-outline focus:outline-none resize-y"
            placeholder={PLACEHOLDER[format]}
            spellCheck={false}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {format === "curl" && collections.length > 0 && (
            <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <span>Add to</span>
              <select aria-label="Target collection" className={SELECT} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">a new collection</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <div className="font-body-sm text-body-sm text-error flex items-start gap-1" role="alert">
              <Icon name="error" className="text-body-md" /> {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-space-xs px-space-md py-space-sm bg-surface-container-lowest/50 rounded-b-xl">
          <button type="button" onClick={onClose} className={GHOST_BUTTON}>
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || !text.trim()}
            className="flex items-center gap-1 px-space-md py-1.5 rounded bg-primary text-on-primary hover:bg-primary-container font-label-md text-label-md font-semibold disabled:opacity-50"
          >
            <Icon name={busy ? "progress_activity" : "file_download"} className={`text-body-md ${busy ? "animate-spin" : ""}`} />
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
