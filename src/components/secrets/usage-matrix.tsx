import { Icon } from "@/components/icon";
import { MATRIX_COLUMNS, MATRIX_NODES } from "./data";

/** Section 3: secret usage matrix (canvas pipeline node bindings). */
export function UsageMatrix() {
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs">
        <div>
          <div className="flex items-center gap-space-xs">
            <Icon name="account_tree" className="text-primary text-headline-sm" />
            <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Flow Canvas Secret Usage Matrix
            </h2>
          </div>
          <p className="font-body-sm text-body-sm text-outline">
            Live inspection of which pipeline graph nodes consume vaulted credentials and keys.
          </p>
        </div>
        <div className="flex items-center gap-space-xs text-outline font-label-sm text-label-sm">
          <span className="w-2.5 h-2.5 rounded bg-primary" /> <span>Direct Ref</span>
          <span className="w-2.5 h-2.5 rounded bg-tertiary ml-space-xs" /> <span>Interpolated Ref</span>
          <span className="w-2.5 h-2.5 rounded bg-surface-container-highest ml-space-xs" /> <span>Unused</span>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-surface-container-low shadow-sm">
        <div className="min-w-[760px] p-space-md">
          <div className="grid grid-cols-6 gap-space-xs mb-space-sm text-outline font-label-sm text-label-sm uppercase tracking-wider pb-space-xs bg-surface-container-lowest/50 p-space-xs rounded-lg">
            <div className="col-span-2">Flow Canvas Node</div>
            {MATRIX_COLUMNS.map((col) => (
              <div key={col} className="text-center">
                {col}
              </div>
            ))}
          </div>
          <div className="space-y-space-xs">
            {MATRIX_NODES.map((node) => (
              <div
                key={node.id}
                className="grid grid-cols-6 gap-space-xs items-center p-space-xs rounded-lg bg-surface-container hover:bg-surface-container-high transition-colors"
              >
                <div className="col-span-2 flex items-center gap-space-xs">
                  <Icon name={node.icon} className={`${node.iconClassName} text-body-lg`} />
                  <div>
                    <div className="font-headline-sm text-headline-sm text-on-surface font-semibold">{node.title}</div>
                    <div className="font-label-sm text-label-sm text-outline">{node.subtitle}</div>
                  </div>
                </div>
                {node.bindings.map((binding, i) => (
                  <div key={MATRIX_COLUMNS[i]} className="flex justify-center">
                    {binding ? (
                      <span
                        className={`px-space-xs py-space-xxs rounded ${binding.className} font-label-sm text-label-sm font-semibold flex items-center gap-1`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${binding.dot}`} /> {binding.label}
                      </span>
                    ) : (
                      <span className="w-6 h-6 rounded bg-surface-container-highest text-outline flex items-center justify-center font-label-sm text-label-sm">
                        -
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
