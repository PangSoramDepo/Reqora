import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { NavLinks } from "./nav-links";
import { NodeLibrary } from "./node-library";

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-surface-container-low/95 backdrop-blur-xl z-50 flex flex-col shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div className="h-14 px-space-md flex items-center justify-between bg-surface-container-lowest/60">
        <div className="flex items-center gap-space-xs">
          <Icon name="account_tree" className="text-primary text-headline-sm" />
          <span className="font-headline-sm text-headline-sm text-on-surface uppercase tracking-wider font-semibold">
            Node Library
          </span>
        </div>
        <button
          className="p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Collapse Library Rail"
          type="button"
        >
          <Icon name="first_page" className="text-body-lg" />
        </button>
      </div>

      <NodeLibrary />

      <div className="mt-auto p-space-sm bg-surface-container-lowest/50">
        <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-space-xs">
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
