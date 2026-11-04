"use client";

import { Icon } from "@/components/icon";
import type { EffectiveRequest, Scope } from "@/lib/collections/inherit";
import type { Auth } from "@/lib/collections/schema";
import { TemplateInput } from "./template-field";
import { FIELD, LABEL, SELECT } from "./ui";

export const AUTH_LABELS: Record<Auth["type"], string> = {
  inherit: "Inherit auth from parent",
  none: "No auth",
  bearer: "Bearer token",
  basic: "Basic auth",
  apiKey: "API key header",
};

/** Where an inherited value comes from, for "Bearer token from folder “Orders”". */
export type InheritSource = { scope: Exclude<Scope, "request">; id: string; name: string };

type Props = {
  auth: Auth;
  set: (fn: (auth: Auth) => Auth) => void;
  /** What the level is called in copy: "request", "folder", "collection". */
  level: Scope;
  /** Offer "Inherit auth from parent" (requests and folders). */
  allowInherit: boolean;
  /** What "inherit" resolves to, and where it comes from (null source = nothing up the chain sets auth). */
  inherited?: { auth: EffectiveRequest["auth"]; source: InheritSource | null };
  onOpenSource?: (source: InheritSource) => void;
};

function describe(auth: EffectiveRequest["auth"]): string {
  switch (auth.type) {
    case "none":
      return "No auth";
    case "bearer":
      return "Bearer token";
    case "basic":
      return `Basic auth (${auth.username || "no username"})`;
    case "apiKey":
      return `API key in ${auth.header || "header"}`;
  }
}

export function AuthPanel({ auth, set, level, allowInherit, inherited, onOpenSource }: Props) {
  const field = (label: string, value: string, onValue: (v: string) => void, placeholder = "{{env.NAME}}") => (
    <label className="flex flex-col gap-space-xxs">
      <span className={LABEL}>{label}</span>
      <TemplateInput aria-label={label} className={FIELD} value={value} onValue={onValue} placeholder={placeholder} />
    </label>
  );
  // A collection has no parent: its "inherit" behaves as "none".
  const type = !allowInherit && auth.type === "inherit" ? "none" : auth.type;
  return (
    <div className="flex-1 overflow-auto p-space-sm grid grid-cols-1 md:grid-cols-[220px_1fr] gap-space-md">
      <label className="flex flex-col gap-space-xxs">
        <span className={LABEL}>Type</span>
        <select
          aria-label="Auth type"
          className={`${SELECT} py-1.5`}
          value={type}
          onChange={(e) => {
            const next = e.target.value as Auth["type"];
            set(() =>
              next === "bearer"
                ? { type: next, token: "" }
                : next === "basic"
                  ? { type: next, username: "", password: "" }
                  : next === "apiKey"
                    ? { type: next, header: "X-API-Key", value: "" }
                    : next === "inherit"
                      ? { type: "inherit" }
                      : { type: "none" },
            );
          }}
        >
          {allowInherit && <option value="inherit">{AUTH_LABELS.inherit}</option>}
          <option value="none">{AUTH_LABELS.none}</option>
          <option value="bearer">{AUTH_LABELS.bearer}</option>
          <option value="basic">{AUTH_LABELS.basic}</option>
          <option value="apiKey">{AUTH_LABELS.apiKey}</option>
        </select>
        <span className="font-body-sm text-body-sm text-outline mt-space-xs">
          Use <code className="text-tertiary">{"{{env.NAME}}"}</code> to reference a secret — the value never reaches the browser.
        </span>
      </label>
      <div className="flex flex-col gap-space-sm">
        {type === "inherit" && (
          <div className="flex flex-col gap-space-xs p-space-sm rounded bg-surface-container-low" data-testid="inherited-auth">
            <span className={LABEL}>Inherited</span>
            {inherited?.source ? (
              <p className="font-body-sm text-body-sm text-on-surface flex flex-wrap items-center gap-1">
                <Icon name="subdirectory_arrow_right" className="text-body-sm text-primary" />
                <strong className="font-semibold">{describe(inherited.auth)}</strong>
                <span className="text-on-surface-variant">from {inherited.source.scope}</span>
                <button
                  type="button"
                  onClick={() => inherited.source && onOpenSource?.(inherited.source)}
                  className="text-primary hover:underline font-medium"
                  title={`Open ${inherited.source.scope} settings`}
                >
                  “{inherited.source.name}”
                </button>
              </p>
            ) : (
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                No parent sets auth, so this {level} sends no authorization. Set it in the folder or collection settings.
              </p>
            )}
            <p className="font-body-sm text-body-sm text-outline">
              Auth is added after pre-request scripts run, unless a script sets that header itself.
            </p>
          </div>
        )}
        {type === "none" && (
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            {level === "collection" ? "Requests in this collection send no authorization unless a folder or request sets it." : `This ${level} sends no authorization.`}
          </p>
        )}
        {auth.type === "bearer" && field("Token", auth.token, (token) => set((a) => (a.type === "bearer" ? { ...a, token } : a)))}
        {auth.type === "basic" && (
          <>
            {field("Username", auth.username, (username) => set((a) => (a.type === "basic" ? { ...a, username } : a)), "username")}
            {field("Password", auth.password, (password) => set((a) => (a.type === "basic" ? { ...a, password } : a)))}
          </>
        )}
        {auth.type === "apiKey" && (
          <>
            {field("Header", auth.header, (header) => set((a) => (a.type === "apiKey" ? { ...a, header } : a)), "X-API-Key")}
            {field("Value", auth.value, (value) => set((a) => (a.type === "apiKey" ? { ...a, value } : a)))}
          </>
        )}
      </div>
    </div>
  );
}
