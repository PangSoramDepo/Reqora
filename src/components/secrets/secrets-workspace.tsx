"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS, setEnvironment, useEnvironment } from "@/lib/environment";
import { deleteVariable, fetchVariables, type VariablesResponse } from "@/lib/workflows/client";
import { ENVIRONMENTS, type Environment } from "@/lib/workflows/schema";
import { AddSecretDrawer, type DrawerTarget } from "./add-secret-drawer";
import { KpiGrid } from "./kpi-grid";
import { UsageMatrix } from "./usage-matrix";
import { VariablesTable } from "./variables-table";

const ENV_BASE = "flex items-center whitespace-nowrap gap-space-xs px-space-md py-space-xs rounded-lg font-headline-sm text-headline-sm transition-all";
const ENV_IDLE = `${ENV_BASE} text-on-surface-variant hover:text-on-surface`;

/** Names that look like credentials default to the secret kind when set from a missing reference. */
const SECRET_HINT = /SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL|PRIVATE/;

type LoadResult = { environment: Environment; data: VariablesResponse | null; error: string | null; at: number };

function quoteEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:@,+-]*$/.test(value) ? value : JSON.stringify(value);
}

/**
 * Interactive Environment Secrets screen: environment selector (shared with the top bar), KPIs,
 * variables table, usage matrix and the add / edit drawer — all backed by the variables API.
 */
export function SecretsWorkspace() {
  const env = useEnvironment();
  const [result, setResult] = useState<LoadResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [filter, setFilter] = useState("");
  const [drawer, setDrawer] = useState<DrawerTarget | null>(null);
  const [notice, setNotice] = useState<{ env: Environment; tone: "ok" | "error"; text: string } | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVariables(env)
      .then((data) => {
        if (!cancelled) setResult({ environment: env, data, error: null, at: Date.now() });
      })
      .catch((e: Error) => {
        if (!cancelled) setResult({ environment: env, data: null, error: e.message, at: Date.now() });
      });
    return () => {
      cancelled = true;
    };
  }, [env, reloadKey]);

  // Results for another environment are stale: show the loading state until this one arrives.
  const current = result?.environment === env ? result : null;
  const data = current?.data ?? null;
  const loading = !current;
  const now = current?.at ?? 0;

  const reload = () => setReloadKey((k) => k + 1);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const onSaved = (target: Environment, name: string, created: boolean) => {
    setDrawer(null);
    setNotice({
      env,
      tone: "ok",
      text: `${name} ${created ? "created" : "updated"} in ${ENVIRONMENT_LABELS[target].label}.`,
    });
    reload();
  };

  const onDelete = (name: string) => {
    if (!window.confirm(`Delete ${name} from ${ENVIRONMENT_LABELS[env].label}? Workflow nodes referencing {{env.${name}}} will no longer resolve it here.`)) {
      return;
    }
    setBusyName(name);
    deleteVariable(env, name)
      .then(() => {
        setNotice({ env, tone: "ok", text: `${name} deleted from ${ENVIRONMENT_LABELS[env].label}.` });
        reload();
      })
      .catch((e: Error) => setNotice({ env, tone: "error", text: `Could not delete ${name}: ${e.message}` }))
      .finally(() => setBusyName(null));
  };

  const exportEnv = () => {
    if (!data) return;
    const lines = [`# Reqora variables — ${ENVIRONMENT_LABELS[env].label}`];
    for (const v of data.data) {
      if (v.description) lines.push(`# ${v.description.replace(/\s+/g, " ")}`);
      lines.push(v.kind === "secret" ? `# ${v.name}=<secret, not exported>` : `${v.name}=${quoteEnvValue(v.value ?? "")}`);
    }
    for (const m of data.missing) lines.push(`# ${m.name}=<missing: referenced by workflows but not set>`);
    const url = URL.createObjectURL(new Blob([`${lines.join("\n")}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${env}.env`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="flex flex-col w-full pb-16">
        {/* Environment selector & actions */}
        <div className="w-full bg-surface-container-low px-gutter-canvas py-space-lg flex flex-col xl:flex-row xl:items-center justify-between gap-space-md shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center gap-space-md">
            <div className="flex items-center bg-surface-container-lowest p-space-xxs rounded-xl shadow-inner w-fit">
              {ENVIRONMENTS.map((e) => {
                const meta = ENVIRONMENT_LABELS[e];
                return (
                  <button
                    key={e}
                    aria-pressed={env === e}
                    className={env === e ? `${ENV_BASE} bg-surface-container-high ${meta.tone} shadow-sm` : ENV_IDLE}
                    onClick={() => setEnvironment(e)}
                    type="button"
                  >
                    <span className={`w-2 h-2 rounded-full ${meta.dot}`} />
                    <span>{meta.label}</span>
                    <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container text-on-surface-variant ml-space-xxs">
                      {meta.region}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="hidden 2xl:flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg bg-surface-container text-on-surface font-body-sm text-body-sm shadow-sm w-fit whitespace-nowrap">
              <Icon name="shield_lock" className="text-body-md text-tertiary" />
              <span className="text-on-surface-variant">Secrets are write-only · AES-256-GCM at rest</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-space-sm">
            <div className="relative">
              <Icon
                name="search"
                className="absolute left-space-sm top-1/2 -translate-y-1/2 text-outline text-body-md pointer-events-none"
              />
              <input
                aria-label="Filter variables"
                className="bg-surface-container-lowest text-on-surface placeholder:text-outline font-body-sm text-body-sm pl-9 pr-space-md py-space-xs rounded-lg w-56 focus:w-72 transition-all outline-none"
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter keys, workflows, nodes..."
                type="text"
                value={filter}
              />
            </div>
            <button
              className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary text-on-primary hover:bg-primary-container font-headline-sm text-headline-sm font-semibold transition-transform active:scale-95 shadow-md"
              onClick={() => setDrawer({ mode: "add" })}
              type="button"
            >
              <Icon name="key" className="text-body-lg" />
              <span>Add Variable</span>
            </button>
          </div>
        </div>

        <div className="px-gutter-canvas py-space-xl flex flex-col gap-space-xl">
          {/* Notices belong to the environment they were raised in. */}
          {notice?.env === env && (
            <div
              className={`flex items-center gap-space-xs px-space-md py-space-sm rounded-lg font-body-sm text-body-sm ${
                notice.tone === "ok" ? "bg-primary/10 text-primary" : "bg-error-container/40 text-error"
              }`}
              role="status"
            >
              <Icon name={notice.tone === "ok" ? "check_circle" : "error"} className="text-body-md" />
              <span className="flex-1">{notice.text}</span>
              <button className="hover:text-on-surface" onClick={() => setNotice(null)} title="Dismiss" type="button">
                <Icon name="close" className="text-body-md" />
              </button>
            </div>
          )}

          {current?.error ? (
            <div className="flex flex-col items-start gap-space-sm p-space-md rounded-xl bg-error-container/30 text-error" role="alert">
              <div className="flex items-center gap-space-xs font-headline-sm text-headline-sm font-semibold">
                <Icon name="error" className="text-body-lg" />
                Could not load {ENVIRONMENT_LABELS[env].label} variables
              </div>
              <p className="font-body-sm text-body-sm">{current.error}</p>
              <button
                className="flex items-center gap-space-xs px-space-sm py-space-xs rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface font-body-sm text-body-sm"
                onClick={() => {
                  setResult(null);
                  reload();
                }}
                type="button"
              >
                <Icon name="refresh" className="text-body-md" />
                Retry
              </button>
            </div>
          ) : (
            <>
              <KpiGrid data={data} environment={env} />
              <VariablesTable
                busyName={busyName}
                data={data}
                filter={filter}
                loading={loading}
                now={now}
                onDelete={onDelete}
                onEdit={(v) =>
                  setDrawer({
                    mode: "edit",
                    name: v.name,
                    kind: v.kind,
                    description: v.description ?? "",
                    value: v.kind === "plain" ? (v.value ?? "") : "",
                  })
                }
                onExport={exportEnv}
                onRefresh={reload}
                onSetMissing={(name) =>
                  setDrawer({ mode: "add", name, kind: SECRET_HINT.test(name) ? "secret" : "plain" })
                }
              />
              <UsageMatrix data={data} />
            </>
          )}
        </div>
      </div>

      {drawer && (
        <AddSecretDrawer
          key={`${drawer.mode}:${drawer.name ?? ""}`}
          environment={env}
          existingNames={data?.data.map((v) => v.name) ?? []}
          onClose={closeDrawer}
          onSaved={onSaved}
          target={drawer}
        />
      )}
    </>
  );
}
