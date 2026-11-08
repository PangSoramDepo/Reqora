"use client";

import { Icon } from "@/components/icon";

import { RAIL_KEY } from "./boot-script";

/** Collapses the sidebar to an icon rail (or expands it); remembered in this browser. */
export function RailToggle() {
  const toggle = () => {
    const root = document.documentElement;
    const collapsed = root.dataset.rail !== "collapsed";
    if (collapsed) root.dataset.rail = "collapsed";
    else delete root.dataset.rail;
    try {
      localStorage.setItem(RAIL_KEY, collapsed ? "collapsed" : "expanded");
    } catch {
      // Storage unavailable: the change still applies until reload.
    }
  };
  return (
    <button
      className="p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
      title="Collapse or expand the sidebar"
      aria-label="Collapse or expand the sidebar"
      type="button"
      onClick={toggle}
    >
      {/* Both icons render; CSS shows the right one for the current state. */}
      <Icon name="first_page" className="text-body-lg rail-hide" />
      <Icon name="last_page" className="text-body-lg rail-only" />
    </button>
  );
}
