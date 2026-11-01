import { Icon } from "@/components/icon";

const CARD = "p-space-md rounded-xl bg-surface-container-low shadow-sm flex flex-col justify-between";
const LABEL = "font-label-sm text-label-sm uppercase tracking-wider";

/** KPI / telemetry mini bento grid. */
export function KpiGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-space-md">
      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Vaulted Keys</span>
          <Icon name="lock" className="text-primary text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-on-surface font-semibold">28</span>
          <span className="font-body-sm text-body-sm text-primary">+2 this week</span>
        </div>
        <div className="w-full bg-surface-container-highest rounded-full h-1.5 overflow-hidden">
          <div className="bg-primary h-full rounded-full" style={{ width: "78%" }} />
        </div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Active Managed Connectors</span>
          <Icon name="hub" className="text-secondary text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-on-surface font-semibold">4</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">of 4 healthy</span>
        </div>
        <div className="flex items-center gap-space-xs">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span className="font-label-sm text-label-sm text-on-surface-variant">
            Stripe, Slack, Twilio, ERP Gateway
          </span>
        </div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Canvas Nodes Bound</span>
          <Icon name="account_tree" className="text-tertiary text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-on-surface font-semibold">14</span>
          <span className="font-body-sm text-body-sm text-on-surface-variant">live pipeline refs</span>
        </div>
        <div className="font-label-sm text-label-sm text-outline">0 unresolved references detected</div>
      </div>

      <div className={CARD}>
        <div className="flex items-center justify-between text-outline">
          <span className={LABEL}>Key Rotation SLA</span>
          <Icon name="cycle" className="text-primary-fixed text-body-md" />
        </div>
        <div className="my-space-xs flex items-baseline gap-space-xs">
          <span className="font-display-lg text-display-lg text-primary font-semibold">98.4%</span>
          <span className="font-body-sm text-body-sm text-tertiary">1 expiring &lt; 30d</span>
        </div>
        <div className="font-label-sm text-label-sm text-on-surface-variant">Auto-rotation hook: AWS Lambda</div>
      </div>
    </div>
  );
}
