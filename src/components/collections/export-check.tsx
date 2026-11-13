"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/icon";
import type { SecretFinding } from "@/lib/collections/secret-scan";

/** Starts a file download from a URL (the export routes send Content-Disposition: attachment). */
export function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Before an export is downloaded: lists values that look like real credentials (masked) so they can be replaced with
 * {{env.*}} / {{user.*}} first. `onExport(false)` exports as is; `onExport(true)` leaves out saved examples.
 */
export function ExportWarningDialog({
  title,
  findings,
  intro,
  onExport,
  onClose,
}: {
  title: string;
  findings: SecretFinding[];
  intro?: ReactNode;
  onExport: (dropExamples: boolean) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const inExamples = findings.filter((f) => f.inExample).length;
  const elsewhere = findings.length - inExamples;
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-space-md"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl bg-surface-container-low border border-outline-variant shadow-2xl">
        <div className="px-space-lg pt-space-md pb-space-sm flex items-start gap-space-sm">
          <Icon name={findings.length ? "warning" : "download"} className={`text-headline-sm ${findings.length ? "text-tertiary" : "text-primary"}`} />
          <div className="flex-1 min-w-0">
            <h2 className="font-headline-sm text-headline-sm text-on-surface">{title}</h2>
            {intro}
            {findings.length > 0 && (
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-1">
                These look like real credentials typed into the export ({findings.length}
                {findings.length >= 200 ? "+" : ""} found). Anyone with the file can read them. Replace them with{" "}
                <span className="font-mono text-tertiary">{"{{env.NAME}}"}</span> or <span className="font-mono text-tertiary">{"{{user.NAME}}"}</span>{" "}
                before sharing{inExamples ? ", or leave saved examples out" : ""}.
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-surface-container-high text-on-surface-variant">
            <Icon name="close" className="text-body-lg" />
          </button>
        </div>
        {findings.length > 0 && (
          <ul className="mx-space-lg mb-space-sm overflow-y-auto rounded-lg bg-surface-container-lowest divide-y divide-outline-variant/20" data-testid="export-findings">
            {findings.map((f, i) => (
              <li key={i} className="px-space-sm py-space-xs flex flex-col gap-0.5">
                <span className="font-body-sm text-body-sm text-on-surface break-words">
                  {f.inExample && <span className="mr-1 px-1 rounded bg-secondary-container/30 text-secondary font-label-sm text-label-sm">example</span>}
                  {f.where}
                </span>
                <span className="font-label-sm text-label-sm text-outline">
                  {f.why} · <span className="font-mono">{f.preview}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="px-space-lg pb-space-md pt-space-xs flex flex-wrap items-center justify-end gap-space-xs">
          <button type="button" onClick={onClose} className="px-space-sm py-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-label-md">
            Cancel
          </button>
          {inExamples > 0 && (
            <button
              type="button"
              onClick={() => onExport(true)}
              className="px-space-sm py-1 rounded bg-primary/15 text-primary hover:bg-primary/25 font-label-md text-label-md"
              title="Saved example responses are left out of the file"
            >
              Export without examples{elsewhere ? ` (${elsewhere} left)` : ""}
            </button>
          )}
          <button
            type="button"
            onClick={() => onExport(false)}
            className={`px-space-sm py-1 rounded font-label-md text-label-md font-semibold ${
              findings.length ? "bg-error-container/50 text-on-error-container hover:bg-error-container/70" : "bg-primary text-on-primary hover:bg-primary-container"
            }`}
          >
            {findings.length ? "Export anyway" : "Export"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** A collection export button: checks for credentials first, downloads straight away when there are none. */
export function CollectionExportButton({
  collectionId,
  name,
  format,
  className,
  children,
  title,
}: {
  collectionId: string;
  name: string;
  format: "reqora" | "postman";
  className: string;
  title: string;
  children: ReactNode;
}) {
  const [findings, setFindings] = useState<SecretFinding[] | null>(null);
  const [checking, setChecking] = useState(false);
  const url = (dropExamples: boolean) => {
    const params = new URLSearchParams();
    if (format === "postman") params.set("format", "postman");
    if (dropExamples) params.set("examples", "0");
    const q = params.toString();
    return `/api/collections/${collectionId}/export${q ? `?${q}` : ""}`;
  };
  const start = async () => {
    setChecking(true);
    try {
      const r = await fetch(`/api/collections/${collectionId}/export/check`);
      const body = r.ok ? ((await r.json()) as { findings: SecretFinding[] }) : { findings: [] };
      if (body.findings.length) setFindings(body.findings);
      else download(url(false));
    } catch {
      download(url(false)); // the check is advisory; still export
    } finally {
      setChecking(false);
    }
  };
  return (
    <>
      <button type="button" className={className} title={title} aria-label={format === "postman" ? `Export ${name} for Postman` : `Export ${name}`} disabled={checking} onClick={() => void start()}>
        {children}
      </button>
      {findings && (
        <ExportWarningDialog
          title={`Export “${name}”${format === "postman" ? " for Postman" : ""}?`}
          findings={findings}
          onClose={() => setFindings(null)}
          onExport={(drop) => {
            download(url(drop));
            setFindings(null);
          }}
        />
      )}
    </>
  );
}
