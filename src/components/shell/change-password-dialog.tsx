"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { changePassword } from "@/lib/auth/client";

const MIN_LENGTH = 10;
const INPUT =
  "w-full px-space-sm py-space-xs rounded bg-surface-container-lowest font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40";

/** Change the signed-in user's password. Other sessions are signed out; this one stays signed in. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const problem =
    next && next.length < MIN_LENGTH
      ? `At least ${MIN_LENGTH} characters.`
      : confirm && confirm !== next
        ? "The new passwords don't match."
        : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !current || !next || next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-surface-container-lowest/70 backdrop-blur-sm p-space-lg"
      role="dialog"
      aria-modal="true"
      aria-label="Change password"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <form onSubmit={submit} className="w-full max-w-sm bg-surface-container-low rounded-xl shadow-2xl p-space-md flex flex-col gap-space-sm">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-space-xs font-headline-sm text-headline-sm text-on-surface font-semibold">
            <Icon name="key" className="text-primary" /> Change password
          </span>
          <button type="button" onClick={onClose} className="p-1 rounded text-on-surface-variant hover:text-on-surface" title="Close">
            <Icon name="close" className="text-body-lg" />
          </button>
        </div>
        {done ? (
          <>
            <p className="font-body-sm text-body-sm text-on-surface-variant" role="status">
              <span className="text-primary font-semibold">Password changed.</span> You&apos;re still signed in here; every other browser or
              device was signed out.
            </p>
            <button type="button" onClick={onClose} className="self-end px-space-md py-1.5 rounded bg-primary text-on-primary font-label-md text-label-md font-semibold">
              Done
            </button>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Current password</span>
              <input
                className={INPUT}
                type="password"
                autoComplete="current-password"
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">New password</span>
              <input className={INPUT} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Confirm new password</span>
              <input className={INPUT} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            {(problem || error) && (
              <span className="font-body-sm text-body-sm text-error" role="alert">
                {problem ?? error}
              </span>
            )}
            <span className="font-label-sm text-label-sm text-outline">Other browsers and devices will be signed out.</span>
            <div className="flex justify-end gap-space-xs">
              <button type="button" onClick={onClose} className="px-space-sm py-1.5 rounded text-on-surface-variant hover:text-on-surface font-label-md text-label-md">
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !!problem || !current || !next || next !== confirm}
                className="flex items-center gap-1 px-space-md py-1.5 rounded bg-primary text-on-primary font-label-md text-label-md font-semibold disabled:opacity-50"
              >
                {busy && <Icon name="progress_activity" className="animate-spin text-body-sm" />}
                Change password
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
