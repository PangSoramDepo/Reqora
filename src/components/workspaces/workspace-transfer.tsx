"use client";

import { useRef, useState } from "react";
import { download, ExportWarningDialog } from "@/components/collections/export-check";
import { Icon } from "@/components/icon";
import type { SecretFinding } from "@/lib/collections/secret-scan";
import { switchWorkspace, workspacesChanged } from "@/lib/workspaces/client";

const CARD = "bg-surface-container rounded-xl shadow-sm";
const BUTTON = "flex items-center gap-space-xs px-space-sm py-space-xs rounded font-body-sm text-body-sm transition-colors disabled:opacity-50 disabled:pointer-events-none";
const SECONDARY = `${BUTTON} bg-surface-container-high hover:bg-surface-container-highest text-on-surface`;

type Summary = { collections: number; flows: number; plainVariables: number; secretVariables: number; testUsers: number };
type Imported = { workspaceId: string; counts: { collections: number; flows: number; variables: number; testUsers: number }; notes: string[] };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Move a whole workspace to another Reqora (e.g. a Docker deployment): export it as one file, or import such a
 * file as a new workspace. Secret values never go into the file.
 */
export function WorkspaceTransfer({ workspaceId, workspaceName, canExport }: { workspaceId: string; workspaceName: string; canExport: boolean }) {
  const [check, setCheck] = useState<{ findings: SecretFinding[]; summary: Summary } | null>(null);
  const [imported, setImported] = useState<Imported | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const startExport = async () => {
    setBusy("export");
    setError(null);
    try {
      const r = await fetch(`/api/workspaces/${workspaceId}/export?check=1`);
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { detail?: string }).detail ?? r.statusText);
      setCheck((await r.json()) as { findings: SecretFinding[]; summary: Summary });
    } catch (e) {
      setError(`Export failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const startImport = async (picked: File) => {
    setBusy("import");
    setError(null);
    try {
      const text = await picked.text();
      const r = await fetch("/api/workspaces/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const body = (await r.json().catch(() => ({}))) as Imported & { detail?: string };
      if (!r.ok) throw new Error(body.detail ?? r.statusText);
      setImported(body);
      workspacesChanged(); // the new workspace is in the list (and already the active one for new pages)
    } catch (e) {
      setError(`Import failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <section className={`${CARD} px-space-lg py-space-md flex flex-col gap-space-sm`} aria-label="Move this workspace" data-testid="workspace-transfer">
      <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
        <Icon name="move_group" className="text-primary" /> Export &amp; import
      </h2>
      <p className="font-body-sm text-body-sm text-on-surface-variant">
        One file with this workspace&apos;s collections, flows, variables and test users — to move it to another Reqora (e.g. a Docker server).
        Secret values stay here: you fill them in after importing. Runs, history and members aren&apos;t included.
      </p>
      <div className="flex flex-wrap items-center gap-space-xs">
        <button
          type="button"
          className={SECONDARY}
          disabled={!canExport || busy !== null}
          title={canExport ? undefined : "Editors and owners can export"}
          onClick={() => void startExport()}
        >
          <Icon name={busy === "export" ? "progress_activity" : "download"} className={`text-body-md ${busy === "export" ? "animate-spin" : ""}`} />
          Export workspace
        </button>
        <button type="button" className={SECONDARY} disabled={busy !== null} onClick={() => file.current?.click()}>
          <Icon name={busy === "import" ? "progress_activity" : "upload"} className={`text-body-md ${busy === "import" ? "animate-spin" : ""}`} />
          Import as new workspace
        </button>
        <input
          ref={file}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Workspace file"
          onChange={(e) => {
            const picked = e.target.files?.[0];
            if (picked) void startImport(picked);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="font-body-sm text-body-sm text-error">
          {error}
        </p>
      )}

      {check && (
        <ExportWarningDialog
          title={check.findings.length ? `Export “${workspaceName}”? Check these first` : `Export “${workspaceName}”`}
          findings={check.findings}
          intro={
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-1" data-testid="export-summary">
              The file holds {plural(check.summary.collections, "collection")}, {plural(check.summary.flows, "flow")},{" "}
              {plural(check.summary.plainVariables, "plain variable")} (with values),{" "}
              {plural(check.summary.secretVariables, "secret variable")} by name only and {plural(check.summary.testUsers, "test user")} (no
              passwords or tokens).
            </p>
          }
          onClose={() => setCheck(null)}
          onExport={(drop) => {
            download(`/api/workspaces/${workspaceId}/export${drop ? "?examples=0" : ""}`);
            setCheck(null);
          }}
        />
      )}

      {imported && (
        <div role="status" className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-primary/10" data-testid="import-result">
          <span className="font-body-sm text-body-sm text-primary flex items-center gap-1">
            <Icon name="check_circle" className="text-body-md" />
            Imported {plural(imported.counts.collections, "collection")}, {plural(imported.counts.flows, "flow")},{" "}
            {plural(imported.counts.variables, "variable")} and {plural(imported.counts.testUsers, "test user")} into a new workspace.
          </span>
          {imported.notes.length > 0 && (
            <ul className="list-disc pl-space-lg font-body-sm text-body-sm text-on-surface">
              {imported.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <button type="button" className={`${SECONDARY} self-start`} onClick={() => void switchWorkspace(imported.workspaceId)}>
            <Icon name="arrow_forward" className="text-body-md" /> Open the new workspace
          </button>
        </div>
      )}
    </section>
  );
}
