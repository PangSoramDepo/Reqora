"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { MAX_FORM_FILE_BYTES, type FormField } from "@/lib/collections/schema";
import { TemplateInput } from "./template-field";

type Props = {
  fields: FormField[];
  /** Functional update so token insertion never writes a stale list. */
  onFields: (update: (fields: FormField[]) => FormField[]) => void;
};

const CELL =
  "w-full bg-transparent px-space-sm py-1.5 text-on-surface font-code-block text-code-block placeholder:text-outline focus:outline-none focus:bg-surface-container";

const blank = (): FormField => ({ kind: "text", key: "", value: "", enabled: true });

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/** Decoded size of base64 data. */
const sizeOf = (data: string) => Math.floor((data.length * 3) / 4) - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** multipart/form-data fields: each row is text (with {{templates}}) or a file stored with the request. */
export function FormDataEditor({ fields, onFields }: Props) {
  const [error, setError] = useState<string | null>(null);
  const patch = (index: number, change: (f: FormField) => FormField) =>
    onFields((current) => (index >= current.length ? [...current, change(blank())] : current.map((f, i) => (i === index ? change(f) : f))));
  const display = [...fields, blank()];

  return (
    <div className="flex-1 overflow-auto">
      {error && (
        <div role="alert" className="px-space-sm py-1 bg-error-container/20 text-error font-body-sm text-body-sm flex items-center gap-1">
          <Icon name="error" className="text-body-sm" /> {error}
          <button type="button" className="ml-auto text-outline hover:text-on-surface" onClick={() => setError(null)} aria-label="Dismiss">
            <Icon name="close" className="text-body-sm" />
          </button>
        </div>
      )}
      <table className="w-full table-fixed font-body-sm text-body-sm" aria-label="Form-data fields">
        <thead>
          <tr className="text-left">
            <th className="w-10" />
            <th className="px-space-sm py-1 font-label-sm text-label-sm text-outline uppercase tracking-wider">Key</th>
            <th className="w-20 px-space-sm py-1 font-label-sm text-label-sm text-outline uppercase tracking-wider">Type</th>
            <th className="px-space-sm py-1 font-label-sm text-label-sm text-outline uppercase tracking-wider">Value</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {display.map((field, index) => {
            const placeholder = index === fields.length;
            return (
              <tr key={index} className="group bg-surface-container-lowest odd:bg-surface-container-low/40">
                <td className="text-center">
                  {!placeholder && (
                    <input
                      type="checkbox"
                      aria-label={`Enable ${field.key || "field"}`}
                      checked={field.enabled}
                      onChange={(e) => patch(index, (f) => ({ ...f, enabled: e.target.checked }))}
                      className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    />
                  )}
                </td>
                <td>
                  <TemplateInput
                    className={`${CELL} ${field.enabled ? "" : "line-through text-outline"}`}
                    placeholder="field"
                    aria-label={`Form-data key ${index + 1}`}
                    value={field.key}
                    onValue={(key) => patch(index, (f) => ({ ...f, key }))}
                  />
                </td>
                <td className="px-space-xs">
                  <select
                    aria-label={`Form-data type ${index + 1}`}
                    value={field.kind}
                    onChange={(e) =>
                      patch(index, (f) =>
                        e.target.value === "file"
                          ? { kind: "file", key: f.key, enabled: f.enabled, fileName: "", contentType: "", data: "" }
                          : { kind: "text", key: f.key, enabled: f.enabled, value: "" },
                      )
                    }
                    className="w-full bg-transparent text-on-surface-variant font-label-sm text-label-sm py-1 focus:outline-none cursor-pointer"
                  >
                    <option value="text">Text</option>
                    <option value="file">File</option>
                  </select>
                </td>
                <td>
                  {field.kind === "text" ? (
                    <TemplateInput
                      className={`${CELL} ${field.enabled ? "" : "text-outline"}`}
                      placeholder="value or {{env.NAME}}"
                      aria-label={`Form-data value ${index + 1}`}
                      value={field.value}
                      onValue={(value) => patch(index, (f) => (f.kind === "text" ? { ...f, value } : f))}
                    />
                  ) : (
                    <FilePicker
                      field={field}
                      label={`Form-data file ${index + 1}`}
                      onError={setError}
                      onFile={(file) => {
                        setError(null);
                        patch(index, (f) => ({ ...f, kind: "file", ...file }));
                      }}
                    />
                  )}
                </td>
                <td className="text-center">
                  {!placeholder && (
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => onFields((current) => current.filter((_, i) => i !== index))}
                      className="p-0.5 rounded text-outline opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-error transition-opacity"
                    >
                      <Icon name="close" className="text-body-md" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-space-sm py-1 font-label-sm text-label-sm text-outline">
        Files are saved with the request (up to {formatBytes(MAX_FORM_FILE_BYTES)} each). The multipart boundary and Content-Type are set
        when sending.
      </p>
    </div>
  );
}

/** A binary body: one file sent as the raw request body. */
export function BinaryBodyEditor({
  file,
  onFile,
}: {
  file: { fileName: string; contentType: string; data: string };
  onFile: (file: { fileName: string; contentType: string; data: string }) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex-1 overflow-auto p-space-sm flex flex-col gap-space-sm">
      <div className="flex items-center gap-space-sm min-w-0 -mx-space-sm">
        <FilePicker
          field={file}
          label="Binary body file"
          onError={setError}
          onFile={(f) => {
            setError(null);
            onFile(f);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-error font-body-sm text-body-sm flex items-center gap-1">
          <Icon name="error" className="text-body-sm" /> {error}
        </p>
      )}
      {file.data && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          Sent as-is with <span className="font-code-block text-code-block text-on-surface">Content-Type: {file.contentType || "application/octet-stream"}</span>{" "}
          unless you set that header yourself.
        </p>
      )}
      <p className="font-label-sm text-label-sm text-outline">
        The file is saved with the request (up to {formatBytes(MAX_FORM_FILE_BYTES)}).
      </p>
    </div>
  );
}

function FilePicker({
  field,
  label,
  onFile,
  onError,
}: {
  field: { fileName: string; contentType: string; data: string };
  label: string;
  onFile: (file: { fileName: string; contentType: string; data: string }) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const chosen = field.data !== "";
  return (
    <div className="flex items-center gap-space-xs px-space-sm py-1 min-w-0">
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label={label}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (file.size > MAX_FORM_FILE_BYTES) {
            onError(`${file.name} is ${formatBytes(file.size)}; files can be up to ${formatBytes(MAX_FORM_FILE_BYTES)}.`);
            return;
          }
          onFile({ fileName: file.name.slice(0, 255), contentType: file.type.slice(0, 200), data: await toBase64(file) });
        }}
      />
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="shrink-0 px-2 py-0.5 rounded border border-outline-variant text-on-surface-variant hover:text-on-surface hover:bg-surface-container font-label-sm text-label-sm flex items-center gap-1"
      >
        <Icon name="upload_file" className="text-body-sm" /> {chosen ? "Replace" : "Choose file"}
      </button>
      {chosen ? (
        <span className="truncate text-on-surface font-code-block text-code-block" title={`${field.fileName} · ${field.contentType || "application/octet-stream"}`}>
          {field.fileName} <span className="text-outline">({formatBytes(sizeOf(field.data))})</span>
        </span>
      ) : (
        <span className="truncate text-outline">No file chosen</span>
      )}
    </div>
  );
}
