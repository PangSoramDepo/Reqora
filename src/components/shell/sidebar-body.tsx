"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { NavLinks } from "./nav-links";
import { NodeLibrary } from "./node-library";
import { RailToggle } from "./rail-toggle";

/**
 * The sidebar: the navigation on top; below it on the Flow Canvas, the Node Library (blocks and saved
 * requests to drag in). Other pages have nothing to drop, so they show only the navigation.
 */
export function SidebarBody() {
  const onCanvas = usePathname().startsWith("/flow");
  return (
    <>
      <div className="h-14 shrink-0 px-space-md rail-tight flex items-center justify-between rail-center bg-surface-container-lowest/60">
        <div className="flex items-center gap-space-xs rail-hide">
          <Icon name="hub" className="text-primary text-headline-sm" />
          <span className="font-headline-sm text-headline-sm text-on-surface uppercase tracking-wider font-semibold">Navigation</span>
        </div>
        <RailToggle />
      </div>

      <div className="shrink-0 p-space-sm" data-testid="sidebar-navigation">
        <NavLinks />
      </div>

      {onCanvas && (
        <>
          <div className="shrink-0 px-space-md rail-tight h-11 flex items-center gap-space-xs rail-center bg-surface-container-lowest/60" data-testid="node-library-header">
            <Icon name="account_tree" className="text-primary text-headline-sm" />
            <span className="font-headline-sm text-headline-sm text-on-surface uppercase tracking-wider font-semibold rail-hide">Node Library</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <NodeLibrary />
          </div>
        </>
      )}
    </>
  );
}
