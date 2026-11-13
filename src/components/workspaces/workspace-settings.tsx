"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { fetchSession } from "@/lib/auth/client";
import {
  addMember,
  createWorkspace,
  deleteWorkspace,
  fetchMembers,
  removeMember,
  renameWorkspace,
  setMemberRole,
  switchWorkspace,
  useWorkspaces,
  workspacesChanged,
} from "@/lib/workspaces/client";
import { ROLE_LABELS, ROLES, type Member, type Role } from "@/lib/workspaces/schema";
import { WorkspaceTransfer } from "./workspace-transfer";

const CARD = "bg-surface-container rounded-xl shadow-sm";
const FIELD =
  "px-space-sm py-space-xs rounded bg-surface-container-lowest font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary/40";
const BUTTON = "flex items-center gap-space-xs px-space-sm py-space-xs rounded font-body-sm text-body-sm transition-colors disabled:opacity-50 disabled:pointer-events-none";
const PRIMARY = `${BUTTON} bg-primary text-on-primary hover:bg-primary-container font-semibold`;
const SECONDARY = `${BUTTON} bg-surface-container-high hover:bg-surface-container-highest text-on-surface`;
const DANGER = `${BUTTON} text-error hover:bg-error-container/30`;
const LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";

const ROLE_TONE: Record<Role, string> = { owner: "text-primary", editor: "text-secondary", viewer: "text-tertiary" };

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

type Notice = { tone: "ok" | "error"; text: string };

/** Members & Settings of the active workspace, plus the list of every workspace the user is in. */
export function WorkspaceSettings() {
  const { state, current } = useWorkspaces();
  const [me, setMe] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [invite, setInvite] = useState({ email: "", role: "editor" as Role, name: "", password: "" });
  const [newName, setNewName] = useState("");

  const owner = current?.role === "owner";
  const workspaceId = current?.id;

  const loadMembers = useCallback(() => {
    if (!workspaceId) return;
    fetchMembers(workspaceId)
      .then(setMembers)
      .catch((e: Error) => setNotice({ tone: "error", text: e.message }));
  }, [workspaceId]);

  useEffect(() => {
    fetchSession()
      .then((s) => setMe(s.user?.id ?? null))
      .catch(() => undefined);
  }, []);
  useEffect(loadMembers, [loadMembers]);

  const act = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await action();
      if (done) setNotice({ tone: "ok", text: done });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!current || !state) {
    return <div className="p-gutter-canvas font-body-sm text-body-sm text-outline">Loading workspace…</div>;
  }

  const owners = members?.filter((m) => m.role === "owner").length ?? 0;
  const myRole = members?.find((m) => m.userId === me)?.role;
  const canLeave = myRole !== undefined && (myRole !== "owner" || owners > 1) && state.data.length > 1;

  const rename = () =>
    act(async () => {
      await renameWorkspace(current.id, name!.trim());
      setName(null);
      workspacesChanged();
    }, "Workspace renamed.");

  const remove = () => {
    if (
      !window.confirm(
        `Delete “${current.name}” and everything in it — its flows, runs, collections, secrets and history? This can't be undone.`,
      )
    ) {
      return;
    }
    void act(async () => {
      await deleteWorkspace(current.id);
      const next = state.data.find((w) => w.id !== current.id)!;
      await switchWorkspace(next.id);
    });
  };

  const leave = () => {
    if (!me || !window.confirm(`Leave “${current.name}”? You'll lose access until an owner adds you again.`)) return;
    void act(async () => {
      await removeMember(current.id, me);
      const next = state.data.find((w) => w.id !== current.id)!;
      await switchWorkspace(next.id);
    });
  };

  const add = () =>
    act(async () => {
      const added = await addMember(current.id, {
        email: invite.email.trim(),
        role: invite.role,
        ...(invite.name.trim() ? { name: invite.name.trim() } : {}),
        ...(invite.password ? { password: invite.password } : {}),
      });
      setInvite({ email: "", role: invite.role, name: "", password: "" });
      loadMembers();
      workspacesChanged();
      setNotice({
        tone: "ok",
        text: added.accountCreated
          ? `Created an account for ${added.email} and added them as ${ROLE_LABELS[added.role].label}. Share the first password with them; they can change it from the account menu.`
          : `Added ${added.name} as ${ROLE_LABELS[added.role].label}.`,
      });
    });

  const changeRole = (member: Member, role: Role) =>
    act(async () => {
      await setMemberRole(current.id, member.userId, role);
      loadMembers();
      if (member.userId === me) workspacesChanged();
    }, `${member.name} is now ${ROLE_LABELS[role].label}.`);

  const kick = (member: Member) => {
    if (!window.confirm(`Remove ${member.name} from “${current.name}”?`)) return;
    void act(async () => {
      await removeMember(current.id, member.userId);
      loadMembers();
      workspacesChanged();
    }, `${member.name} was removed.`);
  };

  return (
    <div className="flex flex-col w-full pb-16">
      {/* Workspace header */}
      <div className="w-full bg-surface-container-low px-gutter-canvas py-space-lg flex flex-col lg:flex-row lg:items-center justify-between gap-space-md shadow-sm">
        <div className="flex items-center gap-space-md min-w-0">
          <span className="h-12 w-12 shrink-0 rounded-xl bg-primary-container/20 flex items-center justify-center">
            <Icon name="workspaces" className="text-primary text-headline-lg" />
          </span>
          <div className="min-w-0">
            {name === null ? (
              <div className="flex items-center gap-space-xs">
                <h1 className="font-headline-lg text-headline-lg text-on-surface truncate">{current.name}</h1>
                {owner && (
                  <button className="p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container" onClick={() => setName(current.name)} title="Rename workspace" type="button">
                    <Icon name="edit" className="text-body-md" />
                  </button>
                )}
              </div>
            ) : (
              <form
                className="flex items-center gap-space-xs"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) void rename();
                }}
              >
                <input autoFocus aria-label="Workspace name" className={`${FIELD} font-headline-sm text-headline-sm`} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                <button className={PRIMARY} disabled={busy || !name.trim()} type="submit">
                  Save
                </button>
                <button className={SECONDARY} onClick={() => setName(null)} type="button">
                  Cancel
                </button>
              </form>
            )}
            <div className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
              <span className={ROLE_TONE[current.role]}>You are {ROLE_LABELS[current.role].label}</span>
              <span className="text-outline">·</span>
              <span>
                {current.memberCount} member{current.memberCount === 1 ? "" : "s"}
              </span>
              <span className="text-outline">·</span>
              <span>Flows, collections, runs and secrets here are shared with its members only</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-space-xs">
          {canLeave && (
            <button className={SECONDARY} disabled={busy} onClick={leave} type="button">
              <Icon name="logout" className="text-body-md" /> Leave
            </button>
          )}
          {owner && (
            <button
              className={DANGER}
              disabled={busy || state.data.length === 1}
              onClick={remove}
              title={state.data.length === 1 ? "You can't delete your only workspace; create another one first" : "Delete this workspace and everything in it"}
              type="button"
            >
              <Icon name="delete" className="text-body-md" /> Delete workspace
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`mx-gutter-canvas mt-space-md px-space-md py-space-sm rounded-lg font-body-sm text-body-sm flex items-center gap-space-xs ${
            notice.tone === "error" ? "bg-error-container/40 text-on-error-container" : "bg-primary/10 text-primary"
          }`}
        >
          <Icon name={notice.tone === "error" ? "error" : "check_circle"} className="text-body-md" />
          {notice.text}
        </div>
      )}

      <div className="px-gutter-canvas pt-space-lg grid grid-cols-1 xl:grid-cols-3 gap-space-lg">
        {/* Members */}
        <section className={`${CARD} xl:col-span-2 flex flex-col`} aria-label="Members">
          <div className="px-space-lg py-space-md flex items-center justify-between">
            <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
              <Icon name="group" className="text-primary" /> Members
            </h2>
            <span className="font-label-sm text-label-sm text-outline">{members?.length ?? "…"}</span>
          </div>
          <div className="flex flex-col" data-testid="members">
            {members?.map((m) => (
              <div key={m.userId} className="px-space-lg py-space-sm flex items-center gap-space-md hover:bg-surface-container-high/50">
                <span className="w-9 h-9 shrink-0 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-label-md flex items-center justify-center">
                  {initials(m.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-body-md text-body-md text-on-surface truncate">
                    {m.name}
                    {m.userId === me && <span className="ml-space-xs font-label-sm text-label-sm text-outline">(you)</span>}
                  </div>
                  <div className="font-body-sm text-body-sm text-outline truncate">{m.email}</div>
                </div>
                {owner ? (
                  <select
                    aria-label={`Role of ${m.name}`}
                    className={`${FIELD} ${ROLE_TONE[m.role]}`}
                    disabled={busy}
                    value={m.role}
                    onChange={(e) => void changeRole(m, e.target.value as Role)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r} className="text-on-surface">
                        {ROLE_LABELS[r].label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={`font-label-md text-label-md ${ROLE_TONE[m.role]}`}>{ROLE_LABELS[m.role].label}</span>
                )}
                {owner && m.userId !== me && (
                  <button className="p-1 rounded text-outline hover:text-error hover:bg-error-container/20" disabled={busy} onClick={() => kick(m)} title={`Remove ${m.name}`} type="button">
                    <Icon name="person_remove" className="text-body-md" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {owner && (
            <form
              className="mt-auto border-t border-outline-variant/20 px-space-lg py-space-md flex flex-col gap-space-sm"
              onSubmit={(e) => {
                e.preventDefault();
                if (invite.email.trim()) void add();
              }}
            >
              <span className={LABEL}>Add a member</span>
              <div className="flex flex-wrap items-center gap-space-xs">
                <input
                  aria-label="Email"
                  className={`${FIELD} flex-1 min-w-56`}
                  placeholder="teammate@company.com"
                  type="email"
                  value={invite.email}
                  onChange={(e) => setInvite({ ...invite, email: e.target.value })}
                />
                <select aria-label="Role" className={FIELD} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as Role })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r].label}
                    </option>
                  ))}
                </select>
                <button className={PRIMARY} disabled={busy || !invite.email.trim()} type="submit">
                  <Icon name="person_add" className="text-body-md" /> Add
                </button>
              </div>
              <details className="font-body-sm text-body-sm text-on-surface-variant">
                <summary className="cursor-pointer text-outline hover:text-on-surface">No Reqora account yet? Create one for them</summary>
                <div className="flex flex-wrap items-center gap-space-xs pt-space-xs">
                  <input
                    aria-label="Their name"
                    className={`${FIELD} flex-1 min-w-40`}
                    placeholder="Their name"
                    value={invite.name}
                    onChange={(e) => setInvite({ ...invite, name: e.target.value })}
                  />
                  <input
                    aria-label="First password"
                    autoComplete="new-password"
                    className={`${FIELD} flex-1 min-w-40`}
                    placeholder="First password (10+ characters)"
                    type="password"
                    value={invite.password}
                    onChange={(e) => setInvite({ ...invite, password: e.target.value })}
                  />
                </div>
                <p className="pt-space-xs text-outline">Share the password with them; they can change it from the account menu after signing in.</p>
              </details>
            </form>
          )}
        </section>

        <div className="flex flex-col gap-space-lg">
          <WorkspaceTransfer workspaceId={current.id} workspaceName={current.name} canExport={current.role !== "viewer"} />

          {/* Roles */}
          <section className={`${CARD} px-space-lg py-space-md flex flex-col gap-space-sm`} aria-label="Roles">
            <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
              <Icon name="admin_panel_settings" className="text-secondary" /> Roles
            </h2>
            {ROLES.map((r) => (
              <div key={r} className="flex flex-col">
                <span className={`font-label-md text-label-md ${ROLE_TONE[r]}`}>{ROLE_LABELS[r].label}</span>
                <span className="font-body-sm text-body-sm text-on-surface-variant">{ROLE_LABELS[r].description}</span>
              </div>
            ))}
          </section>

          {/* All workspaces */}
          <section className={`${CARD} px-space-lg py-space-md flex flex-col gap-space-xs`} aria-label="Your workspaces">
            <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
              <Icon name="workspaces" className="text-primary" /> Your workspaces
            </h2>
            {state.data.map((w) => (
              <div key={w.id} className="flex items-center gap-space-xs py-space-xxs">
                <span className={`flex-1 truncate font-body-sm text-body-sm ${w.id === current.id ? "text-primary" : "text-on-surface"}`}>{w.name}</span>
                <span className={`font-label-sm text-label-sm ${ROLE_TONE[w.role]}`}>{ROLE_LABELS[w.role].label}</span>
                {w.id === current.id ? (
                  <span className="font-label-sm text-label-sm text-outline w-14 text-right">Active</span>
                ) : (
                  <button className="font-label-sm text-label-sm text-on-surface-variant hover:text-primary w-14 text-right" disabled={busy} onClick={() => void act(() => switchWorkspace(w.id))} type="button">
                    Switch
                  </button>
                )}
              </div>
            ))}
            <form
              className="flex items-center gap-space-xs pt-space-xs"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newName.trim()) return;
                void act(async () => {
                  const created = await createWorkspace(newName.trim());
                  await switchWorkspace(created.id);
                });
              }}
            >
              <input aria-label="New workspace name" className={`${FIELD} flex-1 min-w-0`} maxLength={80} placeholder="New workspace" value={newName} onChange={(e) => setNewName(e.target.value)} />
              <button className={SECONDARY} disabled={busy || !newName.trim()} type="submit">
                <Icon name="add" className="text-body-md" /> Create
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
