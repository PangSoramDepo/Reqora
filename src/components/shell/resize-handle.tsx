"use client";

import { useState } from "react";
import { PANELS, type Panel } from "./boot-script";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function currentWidth(panel: Panel): number {
  const { cssVar, initial } = PANELS[panel];
  const style = getComputedStyle(document.documentElement);
  const raw = style.getPropertyValue(cssVar).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return initial;
  // rem (the stylesheet's default) is converted with the root font size.
  return raw.endsWith("rem") ? value * parseFloat(style.fontSize) : value;
}

function setWidth(panel: Panel, width: number, save: boolean) {
  const { cssVar, storageKey } = PANELS[panel];
  document.documentElement.style.setProperty(cssVar, `${width}px`);
  if (!save) return;
  try {
    localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // Storage unavailable: the width applies until reload.
  }
}

/**
 * A drag handle on a panel's inner edge: the left sidebar grows to the right (`edge="right"`), the right-hand
 * inspector grows to the left (`edge="left"`). The width is remembered in this browser; double-click restores
 * the default; with focus, ← and → resize by 16px.
 */
export function ResizeHandle({ panel, edge, label, className = "" }: { panel: Panel; edge: "left" | "right"; label: string; className?: string }) {
  const { min, max, initial } = PANELS[panel];
  const [dragging, setDragging] = useState(false);
  // Growing direction: dragging toward the canvas widens the panel.
  const sign = edge === "right" ? 1 : -1;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = currentWidth(panel);
    const root = document.documentElement;
    root.dataset.resizing = "true";
    setDragging(true);
    let last = startWidth;
    const move = (ev: PointerEvent) => {
      last = clamp(startWidth + sign * (ev.clientX - startX), min, max);
      setWidth(panel, last, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      delete root.dataset.resizing;
      setDragging(false);
      setWidth(panel, last, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = (e.key === "ArrowRight" ? 16 : -16) * sign;
    setWidth(panel, clamp(currentWidth(panel) + delta, min, max), true);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — drag to resize, double-click to reset`}
      data-testid={`resize-${panel}`}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => setWidth(panel, initial, true)}
      className={`group absolute top-0 bottom-0 z-40 w-2 cursor-col-resize touch-none focus:outline-none ${
        edge === "right" ? "right-0" : "left-0"
      } ${className}`}
    >
      <div
        className={`mx-auto h-full w-0.5 transition-colors ${
          dragging ? "bg-primary" : "bg-transparent group-hover:bg-primary/60 group-focus-visible:bg-primary"
        }`}
      />
    </div>
  );
}
