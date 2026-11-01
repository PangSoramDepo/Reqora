"use client";

import { Icon } from "@/components/icon";
import { DELETE_ACTION, type Variable } from "./data";

export type MaskState = Record<string, { revealed: boolean; highlighted: boolean }>;

const ROW_ACTION = "p-space-xs rounded hover:bg-surface-bright transition-colors";
const TOOLBAR_BUTTON =
  "flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface font-body-sm text-body-sm transition-colors";
const TH = "py-space-md px-space-md";
const TD = "py-space-sm px-space-md";

/** Text currently displayed for a variable's value. */
export function displayedValue(v: Variable, mask: MaskState): string {
  if (!v.masked) return v.value;
  return mask[v.id]?.revealed ? v.value : v.masked;
}

type VariablesTableProps = {
  variables: Variable[];
  mask: MaskState;
  allMasked: boolean;
  filter: string;
  onToggleOne: (id: string) => void;
  onToggleAll: () => void;
  onDelete: (id: string) => void;
  onExport: () => void;
};

function matchesFilter(v: Variable, mask: MaskState, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    v.name,
    v.description,
    v.type.label,
    displayedValue(v, mask),
    v.valueNote ?? "",
    v.scope.label,
    v.usage.count,
    v.usage.label,
    v.modified.when,
    v.modified.by,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** Section 2: key vault & environment variables table. */
export function VariablesTable({
  variables,
  mask,
  allMasked,
  filter,
  onToggleOne,
  onToggleAll,
  onDelete,
  onExport,
}: VariablesTableProps) {
  const needle = filter.trim().toLowerCase();
  const rows = variables.filter((v) => matchesFilter(v, mask, needle));

  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div>
          <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Key Vault &amp; Environment Variables
          </h2>
          <p className="font-body-sm text-body-sm text-outline">
            Encrypted via AES-256-GCM at rest. Variable changes propagate to running nodes within 1500ms.
          </p>
        </div>
        <div className="flex items-center gap-space-xs">
          <button className={TOOLBAR_BUTTON} onClick={onToggleAll} type="button">
            <Icon name="visibility" className="text-body-md" />
            <span>{allMasked ? "Reveal Safe Values" : "Mask All Secrets"}</span>
          </button>
          <button className={TOOLBAR_BUTTON} onClick={onExport} type="button">
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
              <th className={TH}>Data Type</th>
              <th className={`${TH} min-w-[280px]`}>Configured Value</th>
              <th className={TH}>Scope</th>
              <th className={TH}>Canvas Usage</th>
              <th className={TH}>Last Modified</th>
              <th className={`${TH} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y-0 text-body-sm font-body-sm">
            {rows.map((v) => {
              const state = mask[v.id];
              const revealed = !v.masked || state?.revealed;
              const highlighted = v.masked && state?.highlighted;
              return (
                <tr key={v.id} className="hover:bg-surface-container transition-colors group">
                  <td className={TD}>
                    <div className="flex items-center gap-space-xs">
                      <span className={`font-headline-sm text-headline-sm font-semibold ${v.nameClassName}`}>
                        {v.name}
                      </span>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-outline hover:text-on-surface transition-opacity"
                        onClick={() => void navigator.clipboard?.writeText(v.name)}
                        title="Copy Key Name"
                        type="button"
                      >
                        <Icon name="content_copy" className="text-body-sm" />
                      </button>
                    </div>
                    <div className="font-label-sm text-label-sm text-outline">{v.description}</div>
                  </td>
                  <td className={TD}>
                    {v.type.icon ? (
                      <span
                        className={`px-space-xs py-space-xxs rounded bg-surface-container-highest ${v.type.className} font-label-sm text-label-sm font-semibold uppercase flex items-center gap-1 w-fit`}
                      >
                        <Icon name={v.type.icon} className="text-body-sm" />
                        {v.type.label}
                      </span>
                    ) : (
                      <span
                        className={`px-space-xs py-space-xxs rounded bg-surface-container-highest ${v.type.className} font-label-sm text-label-sm font-semibold uppercase`}
                      >
                        {v.type.label}
                      </span>
                    )}
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-space-xs bg-surface-container-lowest px-space-sm py-space-xxs rounded-lg max-w-sm">
                      <span
                        className={`font-code-block text-code-block ${
                          highlighted ? v.valueClassName.replace("text-on-surface", "text-primary") : v.valueClassName
                        }`}
                      >
                        {revealed ? v.value : v.masked}
                      </span>
                      {v.valueNote && (
                        <span className="font-label-sm text-label-sm text-outline ml-2">{v.valueNote}</span>
                      )}
                      {v.masked && (
                        <button
                          className="ml-auto text-outline hover:text-on-surface transition-colors"
                          onClick={() => onToggleOne(v.id)}
                          title="Toggle visibility"
                          type="button"
                        >
                          <Icon name={revealed ? "visibility" : "visibility_off"} className="text-body-md" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className={TD}>
                    <span
                      className={`px-space-xs py-space-xxs rounded bg-surface-container-high ${v.scope.className} font-label-sm text-label-sm`}
                    >
                      {v.scope.label}
                    </span>
                  </td>
                  <td className={TD}>
                    <div className="flex items-center gap-space-xs">
                      <span
                        className={`w-5 h-5 rounded-full ${v.usage.className} flex items-center justify-center font-label-sm text-label-sm font-semibold`}
                      >
                        {v.usage.count}
                      </span>
                      <span className="text-on-surface-variant font-label-sm text-label-sm">{v.usage.label}</span>
                    </div>
                  </td>
                  <td className={`${TD} text-outline`}>
                    <div>{v.modified.when}</div>
                    <div className="font-label-sm text-label-sm text-outline-variant">by {v.modified.by}</div>
                  </td>
                  <td className={`${TD} text-right`}>
                    <div className="flex items-center justify-end gap-space-xs">
                      {v.actions.map((a) => (
                        <button key={a.title} className={`${ROW_ACTION} ${a.className}`} title={a.title} type="button">
                          <Icon name={a.icon} className="text-body-md" />
                        </button>
                      ))}
                      <button
                        className={`${ROW_ACTION} ${DELETE_ACTION.className}`}
                        onClick={() => onDelete(v.id)}
                        title={DELETE_ACTION.title}
                        type="button"
                      >
                        <Icon name={DELETE_ACTION.icon} className="text-body-md" />
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
