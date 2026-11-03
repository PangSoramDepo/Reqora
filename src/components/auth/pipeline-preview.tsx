import { Icon } from "@/components/icon";

/** Decorative illustration of a flow; it shows node types Reqora actually supports, not live data. */
export function PipelinePreview() {
  return (
    <>
      <div className="flex flex-col gap-space-xs">
        <div className="flex items-center gap-space-xs text-primary font-label-sm text-label-sm uppercase tracking-widest font-semibold">
          <Icon name="account_tree" className="text-headline-sm" />
          Visual Flow Pipelines
        </div>
        <h2 className="font-headline-lg text-headline-lg text-on-surface font-semibold">
          Wire HTTP APIs together visually, then deploy them behind a webhook.
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant">
          Trigger flows from webhooks, branch on conditions, map payloads between services, and inspect every step of every
          run.
        </p>
      </div>

      <div className="relative bg-surface-container-lowest rounded-xl p-space-xl shadow-2xl overflow-hidden" aria-hidden="true">
        <div className="flex items-center justify-between pb-space-md mb-space-md border-b border-surface-variant/40">
          <div className="flex items-center gap-space-sm">
            <span className="w-3 h-3 rounded-full bg-error/80" />
            <span className="w-3 h-3 rounded-full bg-tertiary/80" />
            <span className="w-3 h-3 rounded-full bg-primary/80" />
            <span className="font-label-sm text-label-sm text-outline ml-2">flow://customer-checkout-pipeline</span>
          </div>
          <span className="px-space-xs py-0.5 rounded bg-surface-container-high text-primary font-label-sm text-label-sm">EXAMPLE</span>
        </div>
        <div className="relative w-full h-[320px] flex items-center justify-between px-space-xs">
          <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
            <path className="opacity-70" d="M 120 80 C 180 80, 180 160, 240 160" fill="none" stroke="#4cd7f6" strokeDasharray="4,4" strokeWidth="2" />
            <path className="opacity-70" d="M 120 240 C 180 240, 180 160, 240 160" fill="none" stroke="#ffb95f" strokeDasharray="4,4" strokeWidth="2" />
            <path d="M 360 160 C 410 160, 410 120, 460 120" fill="none" stroke="#4cd7f6" strokeWidth="2" />
            <circle className="animate-ping" cx="200" cy="120" fill="#4cd7f6" r="3.5" style={{ transformBox: "fill-box", transformOrigin: "center" }} />
            <circle cx="410" cy="140" fill="#acedff" r="3.5" />
          </svg>
          <div className="flex flex-col justify-between h-full py-space-xs z-10">
            <PreviewNode label="WEBHOOK" tone="text-primary" dot="bg-primary animate-pulse" title="POST /hooks/order" detail="trigger.body" />
            <PreviewNode label="CONDITION" tone="text-tertiary" dot="bg-tertiary" title="amount > 500" detail="true / false" />
          </div>
          <div className="z-10 mx-auto">
            <div className="w-36 p-space-md rounded-xl bg-surface-container-highest shadow-2xl relative">
              <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded bg-primary text-on-primary font-label-sm text-[9px] font-bold uppercase tracking-wider">
                Transform
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <Icon name="transform" className="text-primary text-headline-sm" />
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Map Order</span>
              </div>
              <div className="mt-2 p-1.5 rounded bg-surface-container-lowest font-code-block text-[10px] text-primary truncate">
                {"{ id: {{trigger.body.id}} }"}
              </div>
            </div>
          </div>
          <div className="flex flex-col justify-center h-full z-10">
            <PreviewNode label="HTTP" tone="text-secondary" dot="bg-secondary" title="POST /sync-inventory" detail="200 OK" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-space-md">
        <Feature icon="folder_data" tone="text-primary" title="Collections" text="Build and test requests, then drop them onto the canvas." />
        <Feature icon="security" tone="text-tertiary" title="Encrypted Secrets" text="Per-environment variables, write-only and scrubbed from logs." />
        <Feature icon="history" tone="text-secondary" title="Run Traces" text="Waterfall timing, payloads and replay for every execution." />
      </div>
    </>
  );
}

function PreviewNode({ label, tone, dot, title, detail }: { label: string; tone: string; dot: string; title: string; detail: string }) {
  return (
    <div className="w-28 p-space-sm rounded-lg bg-surface-container-high shadow-lg">
      <div className="flex items-center justify-between pb-1">
        <span className={`font-label-sm text-label-sm font-bold ${tone}`}>{label}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      </div>
      <div className="font-body-sm text-body-sm text-on-surface truncate">{title}</div>
      <div className="text-[9px] text-outline font-label-sm">{detail}</div>
    </div>
  );
}

function Feature({ icon, tone, title, text }: { icon: string; tone: string; title: string; text: string }) {
  return (
    <div className="p-space-md rounded-lg bg-surface-container-low flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-on-surface font-label-md text-label-md">
        <Icon name={icon} className={`${tone} text-headline-sm`} />
        {title}
      </div>
      <p className="font-body-sm text-body-sm text-on-surface-variant">{text}</p>
    </div>
  );
}
