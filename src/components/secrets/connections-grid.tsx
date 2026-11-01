import { Icon } from "@/components/icon";
import { CONNECTIONS } from "./data";

const ACTION_BUTTON =
  "p-space-xs rounded bg-surface-container-high hover:bg-surface-bright hover:text-on-surface transition-colors";

/** Section 1: managed third-party connections card grid. */
export function ConnectionsGrid() {
  return (
    <div className="flex flex-col gap-space-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-space-xs">
          <Icon name="lan" className="text-primary text-headline-sm" />
          <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
            Managed Third-Party Connections
          </h2>
          <span className="px-space-xs py-space-xxs rounded bg-surface-container-high text-primary font-label-sm text-label-sm">
            OAuth / mTLS / API Tokens
          </span>
        </div>
        <span className="font-body-sm text-body-sm text-outline">Auto-refreshed via Token Orchestrator</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
        {CONNECTIONS.map((conn) => (
          <div
            key={conn.id}
            className="p-space-md rounded-xl bg-surface-container-low hover:bg-surface-container transition-all flex flex-col justify-between shadow-sm group relative overflow-hidden"
          >
            <div className={`absolute top-0 left-0 right-0 h-1 ${conn.accentBg}`} />
            <div>
              <div className="flex items-center justify-between mb-space-sm">
                <div className="flex items-center gap-space-xs">
                  <div
                    className={`w-8 h-8 rounded-lg bg-surface-container-high flex items-center justify-center ${conn.accentText}`}
                  >
                    <Icon name={conn.icon} className="text-body-lg" />
                  </div>
                  <div>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">{conn.name}</h3>
                    <span className="font-label-sm text-label-sm text-outline">{conn.subtitle}</span>
                  </div>
                </div>
                <span
                  className={`px-space-xs py-space-xxs rounded bg-surface-container-highest ${conn.accentText} font-label-sm text-label-sm uppercase flex items-center gap-1`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${conn.accentBg}`} />
                  {conn.status}
                </span>
              </div>
              <div className="space-y-space-xs py-space-xs text-body-sm font-body-sm">
                {conn.details.map((d) => (
                  <div key={d.label} className="flex items-center justify-between text-outline">
                    <span>{d.label}</span>
                    <span className={d.className}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="pt-space-sm mt-space-xs flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-outline">{conn.footer}</span>
              <div className="flex items-center gap-space-xs">
                {conn.actions.map((a) => (
                  <button
                    key={a.title}
                    className={`${ACTION_BUTTON} ${a.className ?? "text-on-surface-variant"}`}
                    title={a.title}
                    type="button"
                  >
                    <Icon name={a.icon} className="text-body-md" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
