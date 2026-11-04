"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { importCollection, type ImportResult } from "@/lib/collections/client";
import type { Collection } from "@/lib/collections/schema";
import { ENVIRONMENT_LABELS, useEnvironment } from "@/lib/environment";
import { GHOST_BUTTON, SELECT } from "./ui";

export type ImportFormat = "reqora" | "postman" | "curl" | "openapi";
type Format = ImportFormat;

const TAB_LABEL: Record<Format, string> = {
  reqora: "Reqora collection",
  postman: "Postman collection",
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
  postman: `{
  "info": { "name": "My API", "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  "item": []
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
  const environment = useEnvironment();
  const [addVariables, setAddVariables] = useState(true);
  // A Postman import with notes (variables added, things converted) shows them before closing.
  const [result, setResult] = useState<ImportResult | null>(null);

  const submit = () => {
    setBusy(true);
    setError(null);
    importCollection(
      format,
      text,
      format === "curl" && target ? target : undefined,
      format === "postman" && addVariables ? environment : undefined,
    )
      .then((imported) => {
        if (imported.importNotes?.length) {
          setResult(imported);
          setBusy(false);
        } else onImported(imported);
      })
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
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:text-on-surface"
            title="Close"
          >
            <Icon name="close" className="text-body-lg" />
          </button>
        </div>
        {result ? (
          <div className="p-space-md flex flex-col gap-space-sm overflow-auto" data-testid="import-notes">
            <p className="font-body-sm text-body-sm text-on-surface">
              <Icon name="check_circle" className="text-primary text-body-md align-middle" /> Imported{" "}
              <span className="font-semibold">{result.name}</span> with {result.requests.length} request
              {result.requests.length === 1 ? "" : "s"}
              {result.folders.length ? ` in ${result.folders.length} folder${result.folders.length === 1 ? "" : "s"}` : ""}.
            </p>
            <ul className="flex flex-col gap-space-xs">
              {result.importNotes!.map((note) => (
                <li key={note} className="flex items-start gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
                  <Icon name="info" className="text-body-md text-tertiary mt-0.5" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => onImported(result)}
              className="self-end px-space-md py-1.5 rounded bg-primary text-on-primary font-label-md text-label-md font-semibold"
            >
              Open collection
            </button>
          </div>
        ) : (
          <div className="p-space-md flex flex-col gap-space-sm overflow-auto">
            <div className="flex items-center gap-space-xxs" role="tablist">
              {(["reqora", "postman", "curl", "openapi"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={format === f}
                  onClick={() => setFormat(f)}
                  className={`px-space-sm py-1.5 rounded font-label-md text-label-md ${
                    format === f
                      ? "bg-surface-container-high text-primary font-semibold"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  {TAB_LABEL[f]}
                </button>
              ))}
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              {format === "postman"
                ? "Load a collection exported from Postman (Collection v2.1, or v2.0). Folders, requests, auth, headers, params, bodies, saved responses and pre-request / test scripts are imported; pm.* scripts run through Reqora's Postman compatibility layer. {{variables}} become {{env.variables}}."
                : format === "reqora"
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
                  accept={format === "openapi" ? ".json,.yaml,.yml,application/json,text/yaml" : ".json,application/json"}
                  className="font-body-sm text-body-sm text-on-surface-variant file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-surface-container-high file:text-on-surface"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void file.text().then(setText);
                  }}
                />
              </label>
            )}
            <textarea
              aria-label={TAB_LABEL[format]}
              className="w-full h-64 bg-surface-container-lowest rounded p-space-sm font-code-block text-code-block text-on-surface placeholder:text-outline focus:outline-none resize-y"
              placeholder={PLACEHOLDER[format]}
              spellCheck={false}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {format === "postman" && (
              <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
                <input type="checkbox" checked={addVariables} onChange={(e) => setAddVariables(e.target.checked)} />
                <span>
                  Add the collection&apos;s variables (e.g. baseUrl) to{" "}
                  <span className="text-on-surface">{ENVIRONMENT_LABELS[environment].label}</span> — existing values are kept
                </span>
              </label>
            )}
            {format === "curl" && collections.length > 0 && (
              <label className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
                <span>Add to</span>
                <select
                  aria-label="Target collection"
                  className={SELECT}
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
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
        )}
        {!result && (
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
              <Icon
                name={busy ? "progress_activity" : "file_download"}
                className={`text-body-md ${busy ? "animate-spin" : ""}`}
              />
              Import
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
