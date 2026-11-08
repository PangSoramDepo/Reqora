"use client";

import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";
import { NavLinks } from "./nav-links";
import { NodeLibrary } from "./node-library";
import { RailToggle } from "./rail-toggle";

/**
 * The sidebar for the page: on the Flow Canvas, the Node Library (blocks and saved requests to drag in) with
 * the navigation below; elsewhere, where nothing can be dropped, just the navigation.
 */
export function SidebarBody() {
  const onCanvas = usePathname().startsWith("/flow");
  return (
    <>
      <div className="h-14 px-space-md rail-tight flex items-center justify-between rail-center bg-surface-container-lowest/60">
        <div className="flex items-center gap-space-xs rail-hide">
          <Icon name={onCanvas ? "account_tree" : "hub"} className="text-primary text-headline-sm" />
          <span className="font-headline-sm text-headline-sm text-on-surface uppercase tracking-wider font-semibold">
            {onCanvas ? "Node Library" : "Navigation"}
          </span>
        </div>
        <RailToggle />
      </div>

      {onCanvas ? (
        <>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <NodeLibrary />
          </div>
          <div className="shrink-0 p-space-sm bg-surface-container-lowest/50">
            <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-space-xs rail-hide">Navigation</div>
            <NavLinks />
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-space-sm">
          <NavLinks />
        </div>
      )}
    </>
  );
}
