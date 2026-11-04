"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import { putVariable } from "@/lib/workflows/client";
import { ENVIRONMENTS, VARIABLE_NAME, type Environment, type Variable } from "@/lib/workflows/schema";

type Kind = Variable["kind"];

/** What the drawer opens on: a blank / prefilled new variable, or an existing one to replace. */
export type DrawerTarget = {
  mode: "add" | "edit";
  name?: string;
  kind?: Kind;
  description?: string;
  /** Plain values only; secrets can never be read back. */
  value?: string;
};

/** Quick-fill presets: set the kind and a conventional name suffix. */
const PRESETS: { id: string; label: string; icon: string; iconClassName: string; kind: Kind; suffix: string }[] = [
  { id: "apikey", label: "API Key", icon: "key", iconClassName: "text-secondary", kind: "secret", suffix: "_API_KEY" },
  { id: "bearer", label: "Bearer Token", icon: "token", iconClassName: "text-tertiary", kind: "secret", suffix: "_TOKEN" },
  { id: "secret", label: "Client Secret", icon: "lock", iconClassName: "text-tertiary", kind: "secret", suffix: "_SECRET" },
  { id: "password", label: "Basic Auth Password", icon: "badge", iconClassName: "text-primary-fixed", kind: "secret", suffix: "_PASSWORD" },
  { id: "baseurl", label: "Base URL", icon: "link", iconClassName: "text-primary", kind: "plain", suffix: "_BASE_URL" },
  { id: "plain", label: "Plain Value", icon: "code", iconClassName: "text-outline", kind: "plain", suffix: "" },
];
const SUFFIXES = PRESETS.map((p) => p.suffix).filter(Boolean);

function applySuffix(name: string, suffix: string): string {
  let base = name;
  for (const s of SUFFIXES) {
    if (base.endsWith(s) && base.length > s.length) {
      base = base.slice(0, -s.length);
      break;
    }
  }
  if (!suffix) return base;
  return `${base || "SERVICE"}${suffix}`;
}

const PRESET_IDLE =
  "p-space-xs rounded-lg bg-surface-container hover:bg-surface-bright text-on-surface-variant font-body-sm text-body-sm flex flex-col items-center gap-space-xxs";
const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const FIELD =
  "w-full bg-surface-container-lowest px-space-sm py-space-xs rounded-lg text-on-surface font-code-block text-code-block placeholder:text-outline outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 disabled:cursor-not-allowed";
const SELECT =
  "w-full bg-surface-container-lowest px-space-sm py-space-xs rounded-lg text-on-surface font-body-sm text-body-sm outline-none";
const KIND_BASE = "flex-1 flex items-center justify-center gap-space-xs px-space-sm py-space-xs rounded-lg font-body-sm text-body-sm transition-colors";

type AddSecretDrawerProps = {
  target: DrawerTarget;
  /** The page's current environment; edits always write here, new variables default to it. */
  environment: Environment;
  /** Names already defined in the current environment (warns before a silent replace). */
  existingNames: string[];
  onClose: () => void;
  onSaved: (environment: Environment, name: string, created: boolean) => void;
};

/** Slide-over drawer for creating or replacing a variable. Mounted only while open. */
export function AddSecretDrawer({ target, environment, existingNames, onClose, onSaved }: AddSecretDrawerProps) {
  const editing = target.mode === "edit";
  const [name, setName] = useState(target.name ?? "");
  const [kind, setKind] = useState<Kind>(target.kind ?? "secret");
  const [value, setValue] = useState(target.value ?? "");
  const [description, setDescription] = useState(target.description ?? "");
  const [targetEnv, setTargetEnv] = useState<Environment>(environment);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const nameValid = VARIABLE_NAME.test(name);
  const valueRequired = kind === "secret";
  const canSave = nameValid && (!valueRequired || value.length > 0) && !saving;
  const replacesExisting = !editing && targetEnv === environment && existingNames.includes(name);
  const wasSecret = editing && target.kind === "secret";

  const save = () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const trimmed = description.trim();
    putVariable(targetEnv, name, { kind, value, ...(trimmed ? { description: trimmed } : {}) })
      .then(() => {
        // Drop the value from memory before handing control back.
        setValue("");
        onSaved(targetEnv, name, !editing && !replacesExisting);
      })
      .catch((e: Error) => {
        setError(e.message);
        setSaving(false);
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex justify-end transition-opacity duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <form
        aria-label={editing ? `Edit ${name}` : "Add Variable"}
        aria-modal="true"
        autoComplete="off"
        className="w-full max-w-xl bg-surface-container-low h-full shadow-2xl flex flex-col justify-between overflow-y-auto"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        role="dialog"
      >
        <div>
          <div className="h-16 px-space-md flex items-center justify-between bg-surface-container-lowest">
            <div className="flex items-center gap-space-xs">
              <Icon name={editing ? "edit" : "enhanced_encryption"} className="text-primary text-headline-md" />
              <span className="font-headline-md text-headline-md text-on-surface font-semibold">
                {editing ? "Edit Variable" : "Add Variable"}
              </span>
            </div>
            <button
              className="p-space-xs rounded hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
              onClick={onClose}
              title="Close"
              type="button"
            >
              <Icon name="close" className="text-body-lg" />
            </button>
          </div>

          <div className="p-space-md flex flex-col gap-space-md">
            {!editing && (
              <div>
                <span className={`${LABEL} block mb-space-xs`}>Quick Preset</span>
                <div className="grid grid-cols-3 gap-space-xs">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      className={PRESET_IDLE}
                      onClick={() => {
                        setKind(p.kind);
                        setName((n) => applySuffix(n, p.suffix));
                      }}
                      title={`Kind: ${p.kind}${p.suffix ? ` · name ends with ${p.suffix}` : ""}`}
                      type="button"
                    >
                      <Icon name={p.icon} className={`${p.iconClassName} text-body-lg`} />
                      <span>{p.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className={`${LABEL} block mb-space-xxs`} htmlFor="secret-name">
                Variable Key / Name
              </label>
              <input
                aria-invalid={name.length > 0 && !nameValid}
                className={FIELD}
                disabled={editing}
                id="secret-name"
                maxLength={64}
                onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, "_"))}
                placeholder="e.g. STRIPE_SECRET"
                type="text"
                value={name}
              />
              <span className="font-label-sm text-label-sm text-outline mt-1 block">
                {name.length > 0 && !nameValid ? (
                  <span className="text-error">Must start with a letter: A–Z, 0–9 and _ only, up to 64 characters.</span>
                ) : (
                  <>
                    Upper snake-case. Referenced in nodes via{" "}
                    <code className="text-primary">{`{{env.${name || "VAR_NAME"}}}`}</code>
                  </>
                )}
              </span>
              {replacesExisting && (
                <span className="font-label-sm text-label-sm text-tertiary mt-1 flex items-center gap-1">
                  <Icon name="warning" className="text-body-sm" />
                  {name} already exists in {ENVIRONMENT_LABELS[targetEnv].label}; saving replaces it.
                </span>
              )}
            </div>

            <div>
              <span className={`${LABEL} block mb-space-xxs`}>Kind</span>
              <div className="flex gap-space-xs bg-surface-container-lowest p-space-xxs rounded-lg" role="radiogroup">
                {(["secret", "plain"] as const).map((k) => (
                  <button
                    key={k}
                    aria-checked={kind === k}
                    className={
                      kind === k
                        ? `${KIND_BASE} bg-surface-container-high shadow-sm ${k === "secret" ? "text-tertiary" : "text-secondary"}`
                        : `${KIND_BASE} text-on-surface-variant hover:text-on-surface`
                    }
                    onClick={() => setKind(k)}
                    role="radio"
                    type="button"
                  >
                    <Icon name={k === "secret" ? "lock" : "notes"} className="text-body-md" />
                    {k === "secret" ? "Secret (write-only)" : "Plain (readable)"}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-space-xxs">
                <label className={LABEL} htmlFor="drawer-secret-input">
                  {kind === "secret" ? "Secret Value" : "Value"}
                </label>
                {kind === "secret" && (
                  <span className="font-label-sm text-label-sm text-tertiary flex items-center gap-1">
                    <Icon name="shield" className="text-body-sm" />
                    Encrypted at rest · never shown again
                  </span>
                )}
              </div>
              {kind === "secret" ? (
                <input
                  autoComplete="new-password"
                  className={FIELD}
                  id="drawer-secret-input"
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={wasSecret ? "Re-enter the full secret value" : "Paste credential, token, or client secret..."}
                  spellCheck={false}
                  type="password"
                  value={value}
                />
              ) : (
                <textarea
                  className={FIELD}
                  id="drawer-secret-input"
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="e.g. https://api.example.com"
                  rows={3}
                  spellCheck={false}
                  value={value}
                />
              )}
              {wasSecret && (
                <span className="font-label-sm text-label-sm text-outline mt-1 block">
                  The current value is write-only and can&apos;t be displayed. Saving replaces it, so enter the full value
                  again.
                </span>
              )}
            </div>

            <div>
              <label className={`${LABEL} block mb-space-xxs`} htmlFor="secret-description">
                Description
              </label>
              <input
                className={`${FIELD} font-body-sm text-body-sm`}
                id="secret-description"
                maxLength={500}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this used for?"
                type="text"
                value={description}
              />
            </div>

            <div>
              <label className={`${LABEL} block mb-space-xxs`} htmlFor="secret-target-env">
                Target Environment
              </label>
              <select
                className={SELECT}
                disabled={editing}
                id="secret-target-env"
                onChange={(e) => setTargetEnv(e.target.value as Environment)}
                value={targetEnv}
              >
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {ENVIRONMENT_LABELS[e].label}
                    {e === environment ? " (current)" : ""}
                  </option>
                ))}
              </select>
            </div>

            {error && (
              <div className="flex items-start gap-space-xs p-space-sm rounded-lg bg-error-container/40 text-error font-body-sm text-body-sm" role="alert">
                <Icon name="error" className="text-body-md" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>

        <div className="h-16 px-space-md bg-surface-container-lowest flex items-center justify-end gap-space-xs">
          <button
            className="px-space-md py-space-xs rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface font-headline-sm text-headline-sm transition-colors"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="flex items-center gap-space-xs px-space-md py-space-xs rounded-lg bg-primary text-on-primary hover:bg-primary-container font-headline-sm text-headline-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={!canSave}
            type="submit"
          >
            <Icon name={saving ? "progress_activity" : kind === "secret" ? "lock" : "save"} className={`text-body-md ${saving ? "animate-spin" : ""}`} />
            <span>{saving ? "Saving..." : kind === "secret" ? "Encrypt & Save" : "Save Variable"}</span>
          </button>
        </div>
      </form>
    </div>
  );
}
