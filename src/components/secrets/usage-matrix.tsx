import { Icon } from "@/components/icon";
import type { VariablesResponse } from "@/lib/workflows/client";

type Binding = "bound" | "fallback" | "missing";

const BINDING_STYLE: Record<Binding, { label: string; className: string; dot: string; title: string }> = {
  bound: { label: "Bound", className: "bg-primary/20 text-primary", dot: "bg-primary", title: "Set in this environment" },
  fallback: {
    label: "Fallback",
    className: "bg-tertiary/20 text-tertiary",
    dot: "bg-tertiary",
    title: "Not set here; resolved from the server's REQORA_ENV_* variable",
  },
  missing: { label: "Missing", className: "bg-error/20 text-error", dot: "bg-error", title: "Not set here and no server fallback" },
};

const COLUMN_TONE: Record<Binding, string> = { bound: "", fallback: "text-tertiary", missing: "text-error" };

type MatrixRow = { key: string; nodeName: string; workflowName: string; names: Set<string> };

function buildMatrix(data: VariablesResponse) {
  const status = new Map<string, Binding>();
  const rows = new Map<string, MatrixRow>();
  const entries = [
    ...data.data.map((v) => ({ name: v.name, usage: v.usage, binding: "bound" as Binding })),
    ...data.missing.map((m) => ({ name: m.name, usage: m.usage, binding: (m.fromServerEnv ? "fallback" : "missing") as Binding })),
  ];
  for (const { name, usage, binding } of entries) {
    if (usage.length === 0) continue;
    status.set(name, binding);
    for (const ref of usage) {
      const key = `${ref.workflowId}/${ref.nodeId}`;
      const row = rows.get(key) ?? { key, nodeName: ref.nodeName, workflowName: ref.workflowName, names: new Set<string>() };
      row.names.add(name);
      rows.set(key, row);
    }
  }
  const columns = [...status.keys()].sort();
  const sortedRows = [...rows.values()].sort(
    (a, b) => a.workflowName.localeCompare(b.workflowName) || a.nodeName.localeCompare(b.nodeName),
  );
  return { columns, rows: sortedRows, status };
}

/** Which workflow nodes reference which variables, and whether each resolves in this environment. */
export function UsageMatrix({ data }: { data: VariablesResponse | null }) {
  const matrix = data ? buildMatrix(data) : null;
  const gridTemplateColumns = matrix
    ? `minmax(220px, 2fr) repeat(${matrix.columns.length}, minmax(120px, 1fr))`
    : undefined;

  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div>
          <div className="flex items-center gap-space-xs">
            <Icon name="account_tree" className="text-primary text-headline-sm" />
            <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Flow Canvas Variable Usage Matrix
            </h2>
          </div>
          <p className="font-body-sm text-body-sm text-outline">
            Which workflow nodes reference each <code className="text-primary">{"{{env.*}}"}</code> name, and whether it
            resolves in this environment.
          </p>
        </div>
        <div className="flex items-center gap-space-xs text-outline font-label-sm text-label-sm">
          <span className="w-2.5 h-2.5 rounded bg-primary" /> <span>Bound</span>
          <span className="w-2.5 h-2.5 rounded bg-tertiary ml-space-xs" /> <span>Server fallback</span>
          <span className="w-2.5 h-2.5 rounded bg-error ml-space-xs" /> <span>Missing</span>
          <span className="w-2.5 h-2.5 rounded bg-surface-container-highest ml-space-xs" /> <span>Unused</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-container-low shadow-sm">
        {!matrix ? (
          <div className="p-space-md text-outline font-body-sm text-body-sm">Loading usage...</div>
        ) : matrix.rows.length === 0 ? (
          <div className="p-space-md text-outline font-body-sm text-body-sm">
            No workflow node references an environment variable yet.
          </div>
        ) : (
          <div className="w-max min-w-full p-space-md">
            <div
              className="grid gap-space-xs mb-space-sm text-outline font-label-sm text-label-sm uppercase tracking-wider pb-space-xs bg-surface-container-lowest/50 p-space-xs rounded-lg"
              style={{ gridTemplateColumns }}
            >
              <div>Flow Canvas Node</div>
              {matrix.columns.map((col) => (
                <div
                  key={col}
                  className={`text-center truncate ${COLUMN_TONE[matrix.status.get(col) ?? "bound"]}`}
                  title={col}
                >
                  {col}
                </div>
              ))}
            </div>
            <div className="space-y-space-xs">
              {matrix.rows.map((row) => (
                <div
                  key={row.key}
                  className="grid gap-space-xs items-center p-space-xs rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors"
                  style={{ gridTemplateColumns }}
                >
                  <div className="flex items-center gap-space-xs min-w-0">
                    <Icon name="deployed_code" className="text-primary text-body-lg" />
                    <div className="min-w-0">
                      <div className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">
                        {row.nodeName}
                      </div>
                      <div className="font-label-sm text-label-sm text-outline truncate">{row.workflowName}</div>
                    </div>
                  </div>
                  {matrix.columns.map((col) => {
                    const binding = row.names.has(col) ? matrix.status.get(col) : undefined;
                    if (!binding) {
                      return (
                        <div key={col} className="flex justify-center">
                          <span className="w-6 h-6 rounded bg-surface-container-highest text-outline flex items-center justify-center font-label-sm text-label-sm">
                            -
                          </span>
                        </div>
                      );
                    }
                    const style = BINDING_STYLE[binding];
                    return (
                      <div key={col} className="flex justify-center">
                        <span
                          className={`px-space-xs py-space-xxs rounded ${style.className} font-label-sm text-label-sm font-semibold flex items-center gap-1`}
                          title={`${col}: ${style.title}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} /> {style.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
