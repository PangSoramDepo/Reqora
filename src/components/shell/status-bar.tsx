import { Icon } from "@/components/icon";

export function StatusBar() {
  return (
    <footer className="fixed bottom-0 left-64 right-0 h-10 bg-surface-container-low/95 backdrop-blur-xl z-40 px-space-md flex items-center justify-between shadow-[0_-1px_8px_rgba(0,0,0,0.3)]">
      <div className="flex items-center gap-space-md">
        <button
          className="flex items-center gap-space-xs text-primary font-body-sm text-body-sm hover:underline"
          type="button"
        >
          <Icon name="terminal" className="text-body-md" />
          <span>Live Execution Console &amp; Telemetry</span>
        </button>
        <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
          <span className="w-2 h-2 rounded-full bg-primary" />
          <span>READY</span>
          <span className="text-outline">|</span>
          <span>Active Nodes: 14</span>
          <span className="text-outline">|</span>
          <span>Latency: 42ms</span>
        </div>
      </div>
      <div className="flex items-center gap-space-sm font-label-sm text-label-sm text-outline">
        <span>Auto-save enabled</span>
        <button className="text-on-surface-variant hover:text-on-surface" type="button">
          <Icon name="unfold_more" className="text-body-md" />
        </button>
      </div>
    </footer>
  );
}
