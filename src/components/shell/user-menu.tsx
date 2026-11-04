"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { fetchSession, logout, type SessionUser } from "@/lib/auth/client";
import { ChangePasswordDialog } from "./change-password-dialog";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";

export function UserMenu() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSession()
      .then((info) => setUser(info.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  const signOut = async () => {
    await logout().catch(() => undefined);
    router.replace("/login");
    router.refresh();
  };

  return (
    <div ref={rootRef} className="relative pl-space-xs">
      <button
        aria-expanded={open}
        aria-label="Account menu"
        className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-label-md flex items-center justify-center hover:ring-2 hover:ring-primary/40"
        onClick={() => setOpen((v) => !v)}
        title={user ? `${user.name} <${user.email}>` : "Account"}
        type="button"
      >
        {user ? initials(user.name) : <Icon name="person" className="text-body-md" />}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-space-xs w-64 z-50 p-space-xs rounded-xl bg-surface-container-high shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] border border-outline-variant/30">
          {user && (
            <div className="px-space-sm py-space-xs">
              <div className="font-headline-sm text-headline-sm text-on-surface truncate">{user.name}</div>
              <div className="font-body-sm text-body-sm text-outline truncate">{user.email}</div>
            </div>
          )}
          <div className="h-px bg-outline-variant/30 my-space-xs" />
          <button
            className="w-full flex items-center gap-space-xs px-space-sm py-space-xs rounded text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container-highest"
            onClick={() => {
              setOpen(false);
              setChangingPassword(true);
            }}
            type="button"
          >
            <Icon name="key" className="text-body-md" /> Change password
          </button>
          <button
            className="w-full flex items-center gap-space-xs px-space-sm py-space-xs rounded text-left font-body-sm text-body-sm text-on-surface hover:bg-surface-container-highest"
            onClick={signOut}
            type="button"
          >
            <Icon name="logout" className="text-body-md" /> Sign out
          </button>
        </div>
      )}
      {changingPassword && <ChangePasswordDialog onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
