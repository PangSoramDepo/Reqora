import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { NavLinks } from "./nav-links";
import { NodeLibrary } from "./node-library";
import { RailToggle } from "./rail-toggle";

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-[var(--sidebar-w)] transition-[width] overflow-hidden bg-surface-container-low/95 backdrop-blur-xl z-50 flex flex-col shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div className="h-14 px-space-md rail-tight flex items-center justify-between rail-center bg-surface-container-lowest/60">
        <div className="flex items-center gap-space-xs rail-hide">
          <Icon name="account_tree" className="text-primary text-headline-sm" />
          <span className="font-headline-sm text-headline-sm text-on-surface uppercase tracking-wider font-semibold">
            Node Library
          </span>
        </div>
        <RailToggle />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <NodeLibrary />
      </div>

      <div className="shrink-0 p-space-sm bg-surface-container-lowest/50">
        <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-space-xs rail-hide">
          Navigation
        </div>
        {/* usePathname suspends on routes with unresolved dynamic params under cacheComponents. */}
        <Suspense fallback={<div className="h-[120px]" />}>
          <NavLinks />
        </Suspense>
      </div>
    </aside>
  );
}
