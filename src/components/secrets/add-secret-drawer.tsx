"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { AUTH_PRESETS, TARGET_ENV_OPTIONS, VISIBILITY_OPTIONS } from "./data";

export type NewSecret = {
  preset: string;
  name: string;
  value: string;
  targetEnv: string;
  visibility: string;
  autoRotate: boolean;
};

const PRESET_IDLE =
  "p-space-xs rounded-lg bg-surface-container hover:bg-surface-bright text-on-surface-variant font-body-sm text-body-sm flex flex-col items-center gap-space-xxs";
const PRESET_ACTIVE =
  "p-space-xs rounded-lg bg-surface-container-high hover:bg-surface-bright text-on-surface font-body-sm text-body-sm flex flex-col items-center gap-space-xxs shadow-sm";
const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const FIELD =
  "w-full bg-surface-container-lowest px-space-sm py-space-xs rounded-lg text-on-surface font-code-block text-code-block placeholder:text-outline outline-none focus:ring-1 focus:ring-primary";
const SELECT =
  "w-full bg-surface-container-lowest px-space-sm py-space-xs rounded-lg text-on-surface font-body-sm text-body-sm outline-none";

type AddSecretDrawerProps = {
  onClose: () => void;
  onSave: (secret: NewSecret) => void;
};

/** Slide-over drawer for registering a new secret / connection. Mounted only while open. */
export function AddSecretDrawer({ onClose, onSave }: AddSecretDrawerProps) {
  const [preset, setPreset] = useState(AUTH_PRESETS[0].id);
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [targetEnv, setTargetEnv] = useState(TARGET_ENV_OPTIONS[0].value);
  const [visibility, setVisibility] = useState(VISIBILITY_OPTIONS[0].value);
  const [autoRotate, setAutoRotate] = useState(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-surface-container-lowest/80 backdrop-blur-sm flex justify-end transition-opacity duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        aria-label="Register Secret / Connection"
        aria-modal="true"
        className="w-full max-w-xl bg-surface-container-low h-full shadow-2xl flex flex-col justify-between overflow-y-auto"
        role="dialog"
      >
        <div>
          <div className="h-16 px-space-md flex items-center justify-between bg-surface-container-lowest">
            <div className="flex items-center gap-space-xs">
              <Icon name="enhanced_encryption" className="text-primary text-headline-md" />
              <span className="font-headline-md text-headline-md text-on-surface font-semibold">
                Register Secret / Connection
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
            <div>
              <span className={`${LABEL} block mb-space-xs`}>Authentication Type Preset</span>
              <div className="grid grid-cols-3 gap-space-xs">
                {AUTH_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    aria-pressed={preset === p.id}
                    className={preset === p.id ? PRESET_ACTIVE : PRESET_IDLE}
                    onClick={() => setPreset(p.id)}
                    type="button"
                  >
                    <Icon name={p.icon} className={`${p.iconClassName} text-body-lg`} />
                    <span>{p.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={`${LABEL} block mb-space-xxs`} htmlFor="secret-name">
                Variable Key / Name
              </label>
              <input
                className={FIELD}
                id="secret-name"
                onChange={(e) => setName(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                placeholder="e.g. STRIPE_API_SECRET_KEY"
                type="text"
                value={name}
              />
              <span className="font-label-sm text-label-sm text-outline mt-1 block">
                Upper snake-case convention enforced. Referenced via{" "}
                <code className="text-primary">{"{{env.VAR_NAME}}"}</code>
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-space-xxs">
                <label className={LABEL} htmlFor="drawer-secret-input">
                  Secret / Token Value
                </label>
                <span className="font-label-sm text-label-sm text-tertiary flex items-center gap-1">
                  <Icon name="shield" className="text-body-sm" />
                  KMS Encrypted Field
                </span>
              </div>
              <div className="relative">
                <textarea
                  className={FIELD}
                  id="drawer-secret-input"
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Paste credential, private key, or client secret..."
                  rows={3}
                  value={value}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-space-sm">
              <div>
                <label className={`${LABEL} block mb-space-xxs`} htmlFor="secret-target-env">
                  Target Environment
                </label>
                <select
                  className={SELECT}
                  id="secret-target-env"
                  onChange={(e) => setTargetEnv(e.target.value)}
                  value={targetEnv}
                >
                  {TARGET_ENV_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={`${LABEL} block mb-space-xxs`} htmlFor="secret-visibility">
                  Visibility Scope
                </label>
                <select
                  className={SELECT}
                  id="secret-visibility"
                  onChange={(e) => setVisibility(e.target.value)}
                  value={visibility}
                >
                  {VISIBILITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <label className="p-space-sm rounded-lg bg-surface-container-lowest/60 flex items-center justify-between cursor-pointer">
              <div className="flex items-center gap-space-xs">
                <Icon name="autorenew" className="text-primary text-body-lg" />
                <div>
                  <div className="font-headline-sm text-headline-sm text-on-surface font-medium">Auto-Rotation Hook</div>
                  <div className="font-label-sm text-label-sm text-outline">
                    Trigger Lambda or Webhook 7 days prior to expiry
                  </div>
                </div>
              </div>
              <input
                checked={autoRotate}
                className="w-4 h-4 rounded text-primary focus:ring-0 bg-surface-container cursor-pointer"
                onChange={(e) => setAutoRotate(e.target.checked)}
                type="checkbox"
              />
            </label>
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
            disabled={!name.trim()}
            onClick={() => onSave({ preset, name: name.trim(), value, targetEnv, visibility, autoRotate })}
            type="button"
          >
            <Icon name="lock_open" className="text-body-md" />
            <span>Encrypt &amp; Save Secret</span>
          </button>
        </div>
      </div>
    </div>
  );
}
