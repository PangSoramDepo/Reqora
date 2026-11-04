import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { LiveStatusBar } from "./live-status-bar";

export const STATUS_BAR_CLASS =
  "fixed bottom-0 left-64 right-0 h-10 bg-surface-container-low/95 backdrop-blur-xl z-40 px-space-md flex items-center justify-between shadow-[0_-1px_8px_rgba(0,0,0,0.3)]";

export function StatusBar() {
  // The live bar reads the pathname (to scope runs to the open workflow), which suspends on dynamic routes.
  return (
    <Suspense
      fallback={
        <footer className={STATUS_BAR_CLASS}>
          <span className="flex items-center gap-space-xs text-primary font-body-sm text-body-sm">
            <Icon name="terminal" className="text-body-md" />
            <span>Live Execution Console &amp; Telemetry</span>
          </span>
          <span className="font-label-sm text-label-sm text-outline">Auto-save enabled</span>
        </footer>
      }
    >
      <LiveStatusBar className={STATUS_BAR_CLASS} />
    </Suspense>
  );
}
