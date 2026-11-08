import { Suspense } from "react";
import { SidebarBody } from "./sidebar-body";

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-[var(--sidebar-w)] transition-[width] overflow-hidden bg-surface-container-low/95 backdrop-blur-xl z-50 flex flex-col shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      {/* usePathname suspends on routes with unresolved dynamic params under cacheComponents. */}
      <Suspense fallback={<div className="h-14 bg-surface-container-lowest/60" />}>
        <SidebarBody />
      </Suspense>
    </aside>
  );
}
