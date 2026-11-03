"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import type { VariablesResponse, VariableWithUsage } from "@/lib/workflows/client";
import type { VariableReference } from "@/lib/workflows/schema";

const ROW_ACTION = "p-space-xs rounded hover:bg-surface-bright transition-colors disabled:opacity-40";
const TOOLBAR_BUTTON =
  "flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface font-body-sm text-body-sm transition-colors disabled:opacity-50";
const TH = "py-space-md px-space-md";
const TD = "py-space-sm px-space-md";
const SECRET_MASK = "••••••••••••••••••••";

/** "3 minutes ago"-style label; `now` comes from the last fetch so render stays pure. */
export function relativeTime(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then) || !now) return "";
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 45) return "Just now";
  const units: [number, string][] = [
    [60, "minute"],
    [3600, "hour"],
    [86400, "day"],
    [86400 * 30, "month"],
    [86400 * 365, "year"],
  ];
  let label = "";
  for (const [size, unit] of units) {
    const n = Math.round(s / size);
    if (s >= size || unit === "minute") label = `${Math.max(1, n)} ${unit}${Math.max(1, n) === 1 ? "" : "s"} ago`;
  }
  return label;
}

function usageList(usage: VariableReference[]): string {
  return usage.map((u) => `${u.workflowName} · ${u.nodeName}`).join("\n");
}

function usageMatches(usage: VariableReference[], needle: string): boolean {
  return usage.some((u) => `${u.workflowName} ${u.nodeName}`.toLowerCase().includes(needle));
}

function UsageCell({ usage, tone }: { usage: VariableReference[]; tone: "bound" | "fallback" | "missing" }) {
  const count = usage.length;
  const bubble =
    count === 0
      ? "bg-surface-container-highest text-on-surface"
      : tone === "missing"
        ? "bg-error/20 text-error"
        : tone === "fallback"
          ? "bg-tertiary/20 text-tertiary"
        : "bg-primary/20 text-primary";
  const first = usage[0];
  return (
    <div className="flex items-center gap-space-xs" title={count ? usageList(usage) : "Not referenced by any workflow node"}>
      <span className={`w-5 h-5 shrink-0 rounded-full ${bubble} flex items-center justify-center font-label-sm text-label-sm font-semibold`}>
        {count}
      </span>
      <div className="min-w-0">
        <div className="text-on-surface-variant font-label-sm text-label-sm">
          {count === 0 ? "Unbound" : `Flow node${count === 1 ? "" : "s"}`}
        </div>
        {first && (
          <div className="font-label-sm text-label-sm text-outline truncate max-w-[200px]">
            {first.workflowName} · {first.nodeName}
            {count > 1 ? ` +${count - 1}` : ""}
          </div>
        )}
      </div>
    </div>
  );
}

type VariablesTableProps = {
  data: VariablesResponse | null;
  loading: boolean;
  filter: string;
  /** Timestamp of the last fetch, for relative times. */
  now: number;
  busyName: string | null;
  onEdit: (v: VariableWithUsage) => void;
  onDelete: (name: string) => void;
  onSetMissing: (name: string) => void;
  onExport: () => void;
  onRefresh: () => void;
};

/** Variables in the current environment, plus names referenced by nodes but missing here. */
export function VariablesTable({
  data,
  loading,
  filter,
  now,
  busyName,
  onEdit,
  onDelete,
  onSetMissing,
  onExport,
  onRefresh,
}: VariablesTableProps) {
  const [copied, setCopied] = useState<string | null>(null);
  const needle = filter.trim().toLowerCase();

  const rows = (data?.data ?? []).filter(
    (v) =>
      !needle ||
      [v.name, v.description ?? "", v.kind, v.kind === "plain" ? (v.value ?? "") : ""].some((f) =>
        f.toLowerCase().includes(needle),
      ) ||
      usageMatches(v.usage, needle),
  );
  const missing = (data?.missing ?? []).filter(
    (m) => !needle || m.name.toLowerCase().includes(needle) || needle === "missing" || usageMatches(m.usage, needle),
  );

  const copyRef = (name: string) => {
    void navigator.clipboard?.writeText(`{{env.${name}}}`).then(() => {
      setCopied(name);
      setTimeout(() => setCopied((c) => (c === name ? null : c)), 1500);
    });
  };

  const copyButton = (name: string) => (
    <button
      className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-outline hover:text-on-surface transition-opacity"
      onClick={() => copyRef(name)}
      title={`Copy {{env.${name}}}`}
      type="button"
    >
      <Icon name={copied === name ? "check" : "content_copy"} className="text-body-sm" />
    </button>
  );

  const empty = !loading && rows.length === 0 && missing.length === 0;

  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Key Vault &amp; Environment Variables
          </h2>
          <p className="font-body-sm text-body-sm text-outline">
            Nodes read these as <code className="text-primary">{"{{env.NAME}}"}</code> from the run&apos;s environment,
            falling back to the server&apos;s <code className="text-primary">REQORA_ENV_NAME</code>.
          </p>
        </div>
        <div className="flex items-center gap-space-xs">
          <button className={TOOLBAR_BUTTON} disabled={loading} onClick={onRefresh} type="button">
            <Icon name="refresh" className="text-body-md" />
            <span>Refresh</span>
          </button>
          <button className={TOOLBAR_BUTTON} disabled={!data} onClick={onExport} type="button">
            <Icon name="file_download" className="text-body-md" />
            <span>Export .env</span>
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-container-low shadow-md">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-container-lowest/80 text-outline font-label-sm text-label-sm uppercase tracking-wider">
              <th className={TH}>Variable Name &amp; Description</th>
              <th className={TH}>Type</th>
              <th className={`${TH} min-w-[280px]`}>Configured Value</th>
              <th className={TH}>Canvas Usage</th>
              <th className={TH}>Last Modified</th>
              <th className={`${TH} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y-0 text-body-sm font-body-sm">
            {loading && (
              <tr>
                <td className={`${TD} text-outline`} colSpan={6}>
                  <div className="flex items-center gap-space-xs py-space-md">
                    <Icon name="progress_activity" className="text-body-md animate-spin" />
                    Loading variables...
                  </div>
                </td>
              </tr>
            )}
            {empty && (
              <tr>
                <td className={`${TD} text-outline py-space-lg`} colSpan={6}>
                  {needle ? `No variables match “${filter.trim()}”.` : "No variables in this environment yet. Add one to reference it from workflow nodes."}
                </td>
              </tr>
            )}

            {missing.map((m) => {
              // A server fallback still resolves at run time, so it is a warning rather than an error.
              const tone = m.fromServerEnv ? "text-tertiary" : "text-error";
              return (
              <tr
                key={`missing:${m.name}`}
                className={`${m.fromServerEnv ? "bg-tertiary/5 hover:bg-tertiary/10" : "bg-error-container/15 hover:bg-error-container/25"} transition-colors group`}
              >
                <td className={TD}>
                  <div className="flex items-center gap-space-xs">
                    <Icon name="warning" className={`${tone} text-body-md`} />
                    <span className={`font-headline-sm text-headline-sm font-semibold ${tone}`}>{m.name}</span>
                    {copyButton(m.name)}
                  </div>
                  <div className="font-label-sm text-label-sm text-outline">
                    Referenced by workflow nodes but not set in this environment
                  </div>
                </td>
                <td className={TD}>
                  <span
                    className={`px-space-xs py-space-xxs rounded font-label-sm text-label-sm font-semibold uppercase w-fit block whitespace-nowrap ${
                      m.fromServerEnv ? "bg-tertiary/20 text-tertiary" : "bg-error-container/40 text-error"
                    }`}
                  >
                    Missing
                  </span>
                </td>
                <td className={TD}>
                  <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-space-xxs rounded-lg max-w-sm">
                    {m.fromServerEnv ? (
                      <span className="font-label-sm text-label-sm text-tertiary">
                        Falls back to server env <code>REQORA_ENV_{m.name}</code>
                      </span>
                    ) : (
                      <span className="font-label-sm text-label-sm text-error">Unresolved — runs here will fail to resolve it</span>
                    )}
                  </div>
                </td>
                <td className={TD}>
                  <UsageCell tone={m.fromServerEnv ? "fallback" : "missing"} usage={m.usage} />
                </td>
                <td className={`${TD} text-outline`}>—</td>
                <td className={`${TD} text-right`}>
                  <button
                    className="inline-flex items-center gap-1 whitespace-nowrap px-space-sm py-space-xxs rounded-lg bg-error-container/40 hover:bg-error-container/60 text-on-error-container font-label-sm text-label-sm font-semibold transition-colors"
                    onClick={() => onSetMissing(m.name)}
                    type="button"
                  >
                    <Icon name="add" className="text-body-sm" />
                    Set value
                  </button>
                </td>
              </tr>
              );
            })}

            {rows.map((v) => {
              const secret = v.kind === "secret";
              return (
                <tr key={v.name} className="hover:bg-surface-container transition-colors group">
                  <td className={TD}>
                    <div className="flex items-center gap-space-xs">
                      <span
                        className={`font-headline-sm text-headline-sm font-semibold ${secret ? "text-tertiary" : "text-primary"}`}
                      >
                        {v.name}
                      </span>
                      {copyButton(v.name)}
                    </div>
                    <div className="font-label-sm text-label-sm text-outline">{v.description || "No description"}</div>
                  </td>
                  <td className={TD}>
                    {secret ? (
                      <span className="px-space-xs py-space-xxs rounded bg-surface-container-highest text-tertiary font-label-sm text-label-sm font-semibold uppercase flex items-center gap-1 w-fit">
                        <Icon name="lock" className="text-body-sm" />
                        Secret
                      </span>
                    ) : (
                      <span className="px-space-xs py-space-xxs rounded bg-surface-container-highest text-secondary font-label-sm text-label-sm font-semibold uppercase">
                        Plain
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-space-xxs rounded-lg max-w-sm">
                      {secret ? (
                        <>
                          <span className="font-code-block text-code-block text-on-surface truncate font-semibold">
                            {SECRET_MASK}
                          </span>
                          <span
                            className="ml-auto shrink-0 flex items-center gap-1 font-label-sm text-label-sm text-outline"
                            title="Secret values are write-only: they can be replaced but never read back."
                          >
                            <Icon name="visibility_off" className="text-body-sm" />
                            write-only
                          </span>
                        </>
                      ) : (
                        <span className="font-code-block text-code-block text-on-surface truncate" title={v.value ?? ""}>
                          {v.value ? v.value : <span className="text-outline">(empty)</span>}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className={TD}>
                    <UsageCell tone="bound" usage={v.usage} />
                  </td>
                  <td className={`${TD} text-outline`}>
                    <div>{relativeTime(v.updatedAt, now)}</div>
                    <div className="font-label-sm text-label-sm text-outline-variant">
                      {new Date(v.updatedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
                    </div>
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex items-center justify-end gap-space-xs">
                      <button
                        className={`${ROW_ACTION} text-on-surface-variant hover:text-on-surface`}
                        onClick={() => onEdit(v)}
                        title={secret ? "Replace secret" : "Edit variable"}
                        type="button"
                      >
                        <Icon name={secret ? "cached" : "edit"} className="text-body-md" />
                      </button>
                      <button
                        className={`${ROW_ACTION} text-error hover:text-on-error-container`}
                        disabled={busyName === v.name}
                        onClick={() => onDelete(v.name)}
                        title="Delete"
                        type="button"
                      >
                        <Icon name="delete" className="text-body-md" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
