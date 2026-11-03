"use client";

/**
 * The top bar lives in the shared layout, outside the canvas's React tree, so the two talk through
 * window events. Commands flow top bar → canvas; state flows canvas → top bar.
 */
export const CANVAS_COMMAND = "reqora:canvas-command";
export const CANVAS_STATE = "reqora:canvas-state";

export type CanvasCommand = "run" | "deploy" | "zoom-in" | "zoom-out" | "toggle-minimap";

export type CanvasState = {
  zoom: number;
  running: boolean;
  deploying: boolean;
  /** Draft version differs from the deployed one (or never deployed). */
  undeployed: boolean;
};

export function sendCanvasCommand(command: CanvasCommand) {
  window.dispatchEvent(new CustomEvent<CanvasCommand>(CANVAS_COMMAND, { detail: command }));
}

export function publishCanvasState(state: Partial<CanvasState>) {
  window.dispatchEvent(new CustomEvent<Partial<CanvasState>>(CANVAS_STATE, { detail: state }));
}

export function onCanvasCommand(handler: (command: CanvasCommand) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<CanvasCommand>).detail);
  window.addEventListener(CANVAS_COMMAND, listener);
  return () => window.removeEventListener(CANVAS_COMMAND, listener);
}

export function onCanvasState(handler: (state: Partial<CanvasState>) => void) {
  const listener = (event: Event) => handler((event as CustomEvent<Partial<CanvasState>>).detail);
  window.addEventListener(CANVAS_STATE, listener);
  return () => window.removeEventListener(CANVAS_STATE, listener);
}
