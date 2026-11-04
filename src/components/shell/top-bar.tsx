import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { TopBarControls } from "./top-bar-controls";

export function TopBar() {
  return (
    <header className="fixed top-0 left-[var(--sidebar-w)] right-0 h-14 bg-surface-container-low/90 backdrop-blur-xl z-40 px-space-md flex items-center justify-between shadow-[0_1px_8px_rgba(0,0,0,0.25)]">
      <div className="flex items-center gap-space-xs">
        <span className="h-8 w-8 rounded-xl bg-primary-container/20 flex items-center justify-center">
          <Icon name="hub" className="text-primary text-headline-md" />
        </span>
        <span className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">Reqora</span>
      </div>
      {/* Controls read the pathname, which suspends on dynamic routes like /flow/[id]. */}
      <Suspense fallback={<div className="flex-1" />}>
        <TopBarControls />
      </Suspense>
    </header>
  );
}
