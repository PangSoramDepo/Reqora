// Plain module (not "use client"): the root layout inlines BOOT_SCRIPT as text. A string exported from a client
// module would reach the server as a client reference, not as the string.

/** localStorage key of the sidebar's collapsed / expanded state. */
export const RAIL_KEY = "reqora:rail";

/** Resizable panels: the CSS variable each one's width comes from, its saved width and limits. */
export const PANELS = {
  sidebar: { cssVar: "--sidebar-open-w", storageKey: "reqora:sidebar-w", min: 200, max: 480, initial: 256 },
  inspector: { cssVar: "--inspector-w", storageKey: "reqora:inspector-w", min: 300, max: 760, initial: 380 },
} as const;
export type Panel = keyof typeof PANELS;

/**
 * Runs before first paint: sets `data-rail` on <html> for a collapsed sidebar and applies saved panel widths,
 * so nothing flashes open or jumps on load.
 */
export const BOOT_SCRIPT = [
  `try{if(localStorage.getItem(${JSON.stringify(RAIL_KEY)})==="collapsed")document.documentElement.dataset.rail="collapsed"}catch(e){}`,
  ...Object.values(PANELS).map(
    (p) =>
      `try{var w=parseInt(localStorage.getItem(${JSON.stringify(p.storageKey)})||"",10);if(w>=${p.min}&&w<=${p.max})document.documentElement.style.setProperty(${JSON.stringify(p.cssVar)},w+"px")}catch(e){}`,
  ),
].join("");
