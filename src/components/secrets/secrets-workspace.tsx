"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { AddSecretDrawer, type NewSecret } from "./add-secret-drawer";
import { AUTH_PRESETS, ENVIRONMENTS, VARIABLES, VISIBILITY_OPTIONS, type EnvId, type Variable } from "./data";
import { VariablesTable, type MaskState } from "./variables-table";

const ENV_BASE = "flex items-center gap-space-xs px-space-md py-space-xs rounded-lg font-headline-sm text-headline-sm transition-all";
const ENV_IDLE = `${ENV_BASE} text-on-surface-variant hover:text-on-surface`;

function initialMask(vars: Variable[]): MaskState {
  return Object.fromEntries(
    vars.filter((v) => v.masked).map((v) => [v.id, { revealed: Boolean(v.initiallyRevealed), highlighted: false }]),
  );
}

type SecretsWorkspaceProps = {
  /** Server-rendered sections slotted between the interactive pieces. */
  kpis: ReactNode;
  connections: ReactNode;
  matrix: ReactNode;
};

/**
 * Interactive shell of the secrets screen: environment selector, filter box,
 * variables table (masking / delete / export) and the "add secret" drawer.
 */
export function SecretsWorkspace({ kpis, connections, matrix }: SecretsWorkspaceProps) {
  const [env, setEnv] = useState<EnvId>("prod");
  const [filter, setFilter] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [variables, setVariables] = useState<Variable[]>(VARIABLES);
  const [mask, setMask] = useState<MaskState>(() => initialMask(VARIABLES));
  const [allMasked, setAllMasked] = useState(true);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const toggleOne = (id: string) =>
    setMask((m) => {
      const revealed = !m[id]?.revealed;
      return { ...m, [id]: { revealed, highlighted: revealed } };
    });

  const toggleAll = () => {
    const nextMasked = !allMasked;
    setAllMasked(nextMasked);
    setMask(
      Object.fromEntries(
        variables.filter((v) => v.masked).map((v) => [v.id, { revealed: !nextMasked, highlighted: !nextMasked }]),
      ),
    );
  };

  const deleteVariable = (id: string) => setVariables((vs) => vs.filter((v) => v.id !== id));

  const exportEnv = () => {
    const body = variables.map((v) => `${v.name}=${v.masked ? "<redacted>" : v.value}`).join("\n");
    const url = URL.createObjectURL(new Blob([`${body}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${env}.env`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const saveSecret = (secret: NewSecret) => {
    const id = `${secret.name.toLowerCase()}-${Date.now()}`;
    const preset = AUTH_PRESETS.find((p) => p.id === secret.preset);
    const scope = VISIBILITY_OPTIONS.find((o) => o.value === secret.visibility);
    const isRaw = secret.preset === "raw";
    const value = secret.value || "(empty)";
    setVariables((vs) => [
      ...vs,
      {
        id,
        name: secret.name,
        nameClassName: "text-tertiary",
        description: `${preset?.label ?? "Secret"} credential${secret.autoRotate ? " · auto-rotation enabled" : ""}`,
        type: isRaw
          ? { label: "String", className: "text-secondary" }
          : { label: "Secret", icon: "lock", className: "text-tertiary" },
        value,
        masked: "•".repeat(36),
        valueClassName: "text-on-surface truncate font-semibold",
        scope: {
          label: secret.visibility === "global" ? "Global" : (scope?.label ?? "Global"),
          className: secret.visibility === "global" ? "text-primary" : "text-tertiary",
        },
        usage: { count: "0", label: "Unbound", className: "bg-surface-container-highest text-on-surface" },
        modified: { when: "Just now", by: "you" },
        actions: [
          { title: "Edit Variable", icon: "edit", className: "text-on-surface-variant hover:text-on-surface" },
          { title: "Audit Log", icon: "history", className: "text-on-surface-variant hover:text-on-surface" },
        ],
      },
    ]);
    setMask((m) => ({ ...m, [id]: { revealed: !allMasked, highlighted: !allMasked } }));
    setDrawerOpen(false);
  };

  return (
    <>
      <div className="flex flex-col w-full pb-16">
        {/* Top environment meta header & sync status banner */}
        <div className="w-full bg-surface-container-low px-gutter-canvas py-space-lg flex flex-col xl:flex-row xl:items-center justify-between gap-space-md shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-space-md">
            <div className="flex items-center bg-surface-container-lowest p-space-xxs rounded-xl shadow-inner">
              {ENVIRONMENTS.map((e) => (
                <button
                  key={e.id}
                  aria-pressed={env === e.id}
                  className={
                    env === e.id ? `${ENV_BASE} bg-surface-container-high ${e.activeText} shadow-sm` : ENV_IDLE
                  }
                  onClick={() => setEnv(e.id)}
                  type="button"
                >
                  <span className={`w-2 h-2 rounded-full ${e.dot}`} />
                  <span>{e.label}</span>
                  <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container text-on-surface-variant ml-space-xxs">
                    {e.region}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-space-sm">
              <div className="flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg bg-surface-container text-on-surface font-body-sm text-body-sm shadow-sm">
                <Icon name="sync" className="text-primary text-body-md animate-spin" style={{ animationDuration: "6s" }} />
                <span className="font-medium text-on-surface">KMS Enclave:</span>
                <span className="font-label-md text-label-md text-primary">In-Sync (SHA-256: 7f8c9a)</span>
              </div>
              <div className="hidden sm:flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm">
                <Icon name="shield_lock" className="text-body-md text-tertiary" />
                <span>FIPS 140-2 Level 3 HSM</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-space-sm">
            <div className="relative">
              <Icon
                name="search"
                className="absolute left-space-sm top-1/2 -translate-y-1/2 text-outline text-body-md pointer-events-none"
              />
              <input
                aria-label="Filter secrets"
                className="bg-surface-container-lowest text-on-surface placeholder:text-outline font-body-sm text-body-sm pl-9 pr-space-md py-space-xs rounded-lg w-56 focus:w-72 transition-all outline-none"
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter keys, nodes, tags..."
                type="text"
                value={filter}
              />
            </div>
            <button
              className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary text-on-primary hover:bg-primary-container font-headline-sm text-headline-sm font-semibold transition-transform active:scale-95 shadow-md"
              onClick={() => setDrawerOpen(true)}
              type="button"
            >
              <Icon name="key" className="text-body-lg" />
              <span>Add Secret / Connection</span>
            </button>
          </div>
        </div>

        <div className="px-gutter-canvas py-space-xl flex flex-col gap-space-xl">
          {kpis}
          {connections}
          <VariablesTable
            allMasked={allMasked}
            filter={filter}
            mask={mask}
            onDelete={deleteVariable}
            onExport={exportEnv}
            onToggleAll={toggleAll}
            onToggleOne={toggleOne}
            variables={variables}
          />
          {matrix}
        </div>
      </div>

      {drawerOpen && <AddSecretDrawer onClose={closeDrawer} onSave={saveSecret} />}
    </>
  );
}
