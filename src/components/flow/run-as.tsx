"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import { useRunAs, useTestUsers } from "@/lib/users/client";
import { DEFAULT_ROLE, flowRoles, ROLE_NAME, type TestUser } from "@/lib/users/schema";
import type { Environment } from "@/lib/workflows/schema";

const FIELD =
  "px-space-xs py-1 rounded bg-surface-container-lowest font-body-sm text-body-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/40";

/** Who plays a role automatically: the first user with that role tag (or, for an unnamed role, the first user). */
export function automaticUser(users: TestUser[], role: string, onlyRole: boolean): TestUser | undefined {
  return users.find((u) => u.roles.some((r) => r.toLowerCase() === role.toLowerCase())) ?? (role === DEFAULT_ROLE && onlyRole ? users[0] : undefined);
}

/**
 * The canvas's "Run as" control: who plays each of the flow's roles when it runs from here (remembered per flow
 * and environment), and the roles themselves (e.g. maker, authorizer).
 */
export function RunAs({
  workflowId,
  roles,
  environment,
  readOnly,
  onRolesChange,
}: {
  workflowId: string;
  roles: string[] | undefined;
  environment: Environment;
  readOnly?: boolean;
  onRolesChange: (roles: string[] | undefined) => void;
}) {
  const data = useTestUsers(environment);
  const [picked, setPicked] = useRunAs(workflowId, environment);
  const [open, setOpen] = useState(false);
  const [newRole, setNewRole] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const all = flowRoles(roles);
  const users = data?.users ?? [];

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  // Who plays each role right now (picked, else automatic).
  const playing = all.map((role) => {
    const chosen = users.find((u) => u.id === picked[role]);
    return { role, user: chosen ?? automaticUser(users, role, all.length === 1), automatic: !chosen };
  });
  const summary = users.length === 0 ? "No test users" : playing.map((p) => p.user?.name ?? `${p.role}: nobody`).join(", ");
  const missing = users.length > 0 && playing.some((p) => !p.user);

  const addRole = () => {
    const role = newRole.trim();
    if (!ROLE_NAME.test(role) || all.includes(role)) return;
    onRolesChange([...(roles?.length ? roles : []), role]);
    setNewRole("");
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        data-testid="run-as"
        onClick={() => setOpen((v) => !v)}
        title="Who acts when this flow runs from the canvas (test users per role)"
        className={`flex items-center gap-space-xs px-space-sm py-space-xs rounded-xl shadow-lg font-body-sm text-body-sm max-w-56 transition-all ${
          missing ? "bg-tertiary/20 text-tertiary" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
        }`}
      >
        <Icon name={missing ? "person_alert" : "person"} className="text-body-md shrink-0" />
        <span className="truncate">{summary}</span>
        <Icon name="expand_more" className="text-body-md shrink-0" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-space-xs w-80 z-50 p-space-md rounded-xl bg-surface-container-high shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] flex flex-col gap-space-sm" data-testid="run-as-menu">
          <div className="flex items-center justify-between">
            <span className="font-headline-sm text-headline-sm text-on-surface">Run as</span>
            <span className="font-label-sm text-label-sm text-outline">{ENVIRONMENT_LABELS[environment].label}</span>
          </div>
          {users.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant">
              No test users in {ENVIRONMENT_LABELS[environment].label} yet. Add them (with roles like maker / authorizer) on the Secrets page, then steps
              can use <span className="font-mono text-tertiary">{"{{user.login_id}}"}</span>.
            </p>
          ) : (
            playing.map(({ role, user, automatic }) => (
              <label key={role} className="flex flex-col gap-1">
                <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">
                  {role === DEFAULT_ROLE && all.length === 1 ? "Test user" : role}
                </span>
                <select
                  aria-label={`User for ${role}`}
                  className={FIELD}
                  value={automatic ? "" : user!.id}
                  onChange={(e) => {
                    const next = { ...picked };
                    if (e.target.value) next[role] = e.target.value;
                    else delete next[role];
                    setPicked(next);
                  }}
                >
                  <option value="">Automatic{automaticUser(users, role, all.length === 1) ? ` (${automaticUser(users, role, all.length === 1)!.name})` : " — nobody has this role"}</option>
                  {[...users]
                    .sort((a, b) => Number(b.roles.includes(role)) - Number(a.roles.includes(role)))
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                        {u.roles.length ? ` · ${u.roles.join(", ")}` : ""}
                      </option>
                    ))}
                </select>
              </label>
            ))
          )}

          <div className="h-px bg-outline-variant/30" />
          <div className="flex flex-col gap-space-xs">
            <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Roles in this flow</span>
            <div className="flex flex-wrap gap-1">
              {(roles?.length ? roles : []).map((role) => (
                <span key={role} className="flex items-center gap-1 px-space-xs py-0.5 rounded bg-secondary/15 text-secondary font-label-md text-label-md">
                  {role}
                  {!readOnly && (
                    <button type="button" aria-label={`Remove role ${role}`} className="hover:text-on-surface" onClick={() => onRolesChange(roles!.filter((r) => r !== role))}>
                      <Icon name="close" className="text-body-sm" />
                    </button>
                  )}
                </span>
              ))}
              {!roles?.length && <span className="font-body-sm text-body-sm text-outline">One test user acts in every step.</span>}
            </div>
            {!readOnly && (
              <form
                className="flex items-center gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  addRole();
                }}
              >
                <input aria-label="New role" placeholder="e.g. maker, authorizer" className={`${FIELD} flex-1`} value={newRole} onChange={(e) => setNewRole(e.target.value)} />
                <button type="submit" disabled={!ROLE_NAME.test(newRole.trim())} className="px-space-sm py-1 rounded bg-primary text-on-primary font-label-md text-label-md disabled:opacity-50">
                  Add role
                </button>
              </form>
            )}
            <span className="font-body-sm text-body-sm text-outline">Then set “Run as” on each step in the Node Inspector.</span>
          </div>
          <Link href="/secrets?tab=users" className="font-label-md text-label-md text-primary hover:underline self-start">
            Manage test users →
          </Link>
        </div>
      )}
    </div>
  );
}
