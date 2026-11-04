import type { RequestMethod } from "@/lib/collections/schema";

export const METHOD_TONE: Record<RequestMethod, string> = {
  GET: "text-secondary",
  POST: "text-primary",
  PUT: "text-tertiary",
  PATCH: "text-tertiary-fixed-dim",
  DELETE: "text-error",
  HEAD: "text-outline",
  OPTIONS: "text-outline",
};

/** Background for the method <select> in the URL bar. */
export const METHOD_SELECT_TONE: Record<RequestMethod, string> = {
  GET: "bg-secondary-container text-on-secondary-container",
  POST: "bg-primary-container text-on-primary",
  PUT: "bg-tertiary-container text-on-tertiary-container",
  PATCH: "bg-tertiary-container text-on-tertiary-container",
  DELETE: "bg-error-container text-on-error-container",
  HEAD: "bg-surface-container-highest text-on-surface",
  OPTIONS: "bg-surface-container-highest text-on-surface",
};

export function MethodPill({ method, active = false }: { method: RequestMethod; active?: boolean }) {
  return (
    <span
      className={`px-1 py-px rounded font-label-sm text-label-sm font-semibold shrink-0 ${
        active ? "bg-primary-container/20" : "bg-surface-container-highest"
      } ${METHOD_TONE[method]}`}
    >
      {method === "DELETE" ? "DEL" : method === "OPTIONS" ? "OPT" : method}
    </span>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Status pill colours by class: 2xx primary, 3xx secondary, 4xx tertiary, 5xx error. */
export function statusTone(status: number): string {
  if (status < 300) return "bg-primary text-on-primary";
  if (status < 400) return "bg-secondary text-on-secondary";
  if (status < 500) return "bg-tertiary text-on-tertiary";
  return "bg-error text-on-error";
}

export const FIELD =
  "w-full bg-surface-container px-space-sm py-space-xs rounded text-on-surface font-code-block text-code-block placeholder:text-outline focus:outline-none focus:bg-surface-container-high transition-colors";
export const SELECT =
  "bg-surface-container-high text-on-surface font-label-sm text-label-sm px-2 py-1 rounded focus:outline-none cursor-pointer";
export const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
export const GHOST_BUTTON =
  "flex items-center gap-1 px-space-sm py-1.5 rounded bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface font-label-sm text-label-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
export const ICON_BUTTON =
  "p-1 rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-colors disabled:opacity-40 disabled:cursor-not-allowed";
