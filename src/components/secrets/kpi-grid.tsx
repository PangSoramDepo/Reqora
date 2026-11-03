import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import type { VariablesResponse } from "@/lib/workflows/client";
import type { Environment } from "@/lib/workflows/schema";

const CARD = "p-space-md rounded-xl bg-surface-container-low shadow-sm flex flex-col justify-between";
const LABEL = "font-label-sm text-label-sm uppercase tracking-wider";

/** Counts derived from the variables response; null while loading. */
export function variableStats(data: VariablesResponse) {
  const secrets = data.data.filter((v) => v.kind === "secret").length;
  const refs = [...data.data.flatMap((v) => v.usage), ...data.missing.flatMap((m) => m.usage)];
  const nodes = new Set(refs.map((r) => `${r.workflowId}/${r.nodeId}`));
  const workflows = new Set(refs.map((r) => r.workflowId));
  const usedDefined = data.data.filter((v) => v.usage.length > 0).length;
  const referencedNames = usedDefined + data.missing.length;
  return {
    total: data.data.length,
    secrets,
    plain: data.data.length - secrets,
    unused: data.data.length - usedDefined,
    nodes: nodes.size,
    workflows: workflows.size,
    refs: refs.length,
    missing: data.missing.length,
    missingWithFallback: data.missing.filter((m) => m.fromServerEnv).length,
    coverage: referencedNames === 0 ? 1 : usedDefined / referencedNames,
  };
}

type KpiGridProps = { data: VariablesResponse | null; environment: Environment };

/** KPI mini bento grid computed from the current environment's variables. */
export function KpiGrid({ data, environment }: KpiGridProps) {
  const s = data ? variableStats(data) : null;
  const dash = "—";
  const envLabel = ENVIRONMENT_LABELS[environment].label;
  const unresolved = s ? s.missing - s.missingWithFallback : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Variables in {envLabel}</span>
          <Icon name="data_object" className="text-primary text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-on-surface font-semibold">{s ? s.total : dash}</span>
          <span className="font-body-sm text-body-sm text-primary">{s ? `${s.plain} plain` : ""}</span>
        </div>
        <div
          className="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden"
          title={s ? `${Math.round(s.coverage * 100)}% of referenced names are set here` : undefined}
        >
          <div className="bg-primary h-full rounded-full" style={{ width: `${s ? Math.round(s.coverage * 100) : 0}%` }} />
        </div>
        <div className="font-label-sm text-label-sm text-outline mt-space-xxs">
          {s ? `${Math.round(s.coverage * 100)}% of referenced names set` : "Loading..."}
        </div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Secrets</span>
          <Icon name="lock" className="text-tertiary text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-on-surface font-semibold">{s ? s.secrets : dash}</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">write-only</span>
        </div>
        <div className="font-label-sm text-label-sm text-outline">Encrypted at rest, never returned by the API</div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Canvas Nodes Bound</span>
          <Icon name="account_tree" className="text-secondary text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-on-surface font-semibold">{s ? s.nodes : dash}</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">
            {s ? `in ${s.workflows} workflow${s.workflows === 1 ? "" : "s"}` : ""}
          </span>
        </div>
        <div className="font-label-sm text-label-sm text-outline">
          {s ? `${s.refs} {{env.*}} reference${s.refs === 1 ? "" : "s"} · ${s.unused} unused variable${s.unused === 1 ? "" : "s"}` : ""}
        </div>
      </div>

      <div className={`${CARD} ${unresolved > 0 ? "ring-1 ring-error/50" : ""}`}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Missing References</span>
          <Icon name="warning" className={`${s?.missing ? "text-error" : "text-outline"} text-body-md`} />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span
            className={`font-display-lg text-display-lg font-semibold ${
              !s ? "text-on-surface" : unresolved > 0 ? "text-error" : s.missing > 0 ? "text-tertiary" : "text-primary"
            }`}
          >
            {s ? s.missing : dash}
          </span>
          <span className={`font-body-sm text-body-sm ${unresolved > 0 ? "text-error" : "text-on-surface-variant"}`}>
            {!s ? "" : s.missing === 0 ? "all resolved" : unresolved > 0 ? `${unresolved} will fail` : "server fallback"}
          </span>
        </div>
        <div className="font-label-sm text-label-sm text-outline">
          {!s
            ? ""
            : s.missing === 0
              ? `Every {{env.*}} used by a node is set in ${envLabel}`
              : s.missingWithFallback > 0
                ? `${s.missingWithFallback} fall back to REQORA_ENV_* on the server`
                : `Used by nodes but not set in ${envLabel}`}
        </div>
      </div>
    </div>
  );
}
