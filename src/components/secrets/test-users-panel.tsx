"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "@/components/icon";
import { fetchCollections } from "@/lib/collections/client";
import type { Collection } from "@/lib/collections/schema";
import { ENVIRONMENT_LABELS } from "@/lib/environment";
import {
  createTestUser,
  deleteColumn,
  deleteTestUser,
  exportTestUsersUrl,
  importTestUsers,
  loginNow,
  logoutUser,
  patchTestUser,
  putColumn,
  putUserSettings,
  reorderColumns,
  testUsersChanged,
  useTestUsers,
  userFromVariables,
} from "@/lib/users/client";
import { ROLE_NAME, SECRET_HINT, USER_NAME, type ColumnKind, type TestUser, type TestUserColumn } from "@/lib/users/schema";
import type { Environment, Variable } from "@/lib/workflows/schema";

const CARD = "bg-surface-container-low rounded-xl shadow-sm";
const FIELD =
  "px-space-xs py-1 rounded bg-surface-container-lowest font-mono text-body-sm text-on-surface placeholder:text-outline focus:outline-none focus:ring-1 focus:ring-primary/40";
const BTN = "flex items-center gap-1 px-space-sm py-1 rounded font-label-md text-label-md transition-colors disabled:opacity-50";
const PRIMARY = `${BTN} bg-primary text-on-primary hover:bg-primary-container font-semibold`;
const SECONDARY = `${BTN} bg-surface-container-high hover:bg-surface-container-highest text-on-surface`;
const ICON_BTN = "p-1 rounded text-outline hover:text-on-surface hover:bg-surface-container-high";
const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const LOGIN_SCRIPT = `// Post-response script of the login request:
const body = rq.response.json();
rq.user.set("access_token", body.access_token);`;

function ago(iso: string | null | undefined, now: number) {
  if (!iso) return null;
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

type Notice = { tone: "ok" | "error"; text: string };

/** Sticky first / last cells keep their own background so scrolled columns pass underneath. */
const STICKY_LEFT = "sticky left-0 z-10 bg-surface-container-low shadow-[6px_0_6px_-6px_rgba(0,0,0,0.5)]";
const STICKY_RIGHT = "sticky right-0 z-10 bg-surface-container-low shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.5)]";

/**
 * Sideways scrolling for a wide table: a visible scrollbar, plus ‹ › buttons at the edges while there's more to
 * see that way.
 */
function ScrollX({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 2;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  const scroll = (dir: -1 | 1) => box.current?.scrollBy({ left: dir * Math.max(200, box.current.clientWidth * 0.6), behavior: "smooth" });
  return (
    <div>
      {(more.left || more.right) && (
        <div className="px-space-lg pb-space-xs flex items-center justify-end gap-1" data-testid="column-scroll">
          <span className="font-label-sm text-label-sm text-outline mr-1">Scroll for more columns</span>
          {(
            [
              [-1, "chevron_left", "Scroll to earlier columns", more.left],
              [1, "chevron_right", "Scroll to more columns", more.right],
            ] as const
          ).map(([dir, icon, label, enabled]) => (
            <button
              key={dir}
              type="button"
              onClick={() => scroll(dir)}
              disabled={!enabled}
              aria-label={label}
              title={label}
              className="h-7 w-7 flex items-center justify-center rounded-full bg-surface-container-highest text-on-surface hover:bg-primary hover:text-on-primary disabled:opacity-30 disabled:pointer-events-none"
            >
              <Icon name={icon} className="text-body-lg" />
            </button>
          ))}
        </div>
      )}
      <div ref={box} className="overflow-x-auto scrollbar-x pb-1" data-testid="test-users-scroll">
        {children}
      </div>
    </div>
  );
}

/** One cell: plain values edit inline; secrets are write-only (set / replace / clear). */
function ValueCell({ user, column, now, onSave }: { user: TestUser; column: TestUserColumn; now: number; onSave: (value: string | null) => Promise<void> }) {
  const current = user.values[column.name];
  const [draft, setDraft] = useState<string | null>(null);
  if (column.kind === "plain") {
    const shown = draft ?? current?.value ?? "";
    return (
      <input
        aria-label={`${column.name} of ${user.name}`}
        className={`${FIELD} w-full min-w-24`}
        value={shown}
        placeholder="—"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft === null || draft === (current?.value ?? "")) return setDraft(null);
          void onSave(draft === "" ? null : draft).finally(() => setDraft(null));
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  }
  if (draft !== null) {
    return (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          void onSave(draft || null).finally(() => setDraft(null));
        }}
      >
        <input autoFocus type="password" aria-label={`New ${column.name} for ${user.name}`} className={`${FIELD} w-full min-w-24`} value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit" className={ICON_BTN} title="Save (encrypted)">
          <Icon name="check" className="text-body-md" />
        </button>
        <button type="button" className={ICON_BTN} title="Cancel" onClick={() => setDraft(null)}>
          <Icon name="close" className="text-body-md" />
        </button>
      </form>
    );
  }
  return (
    <button
      type="button"
      className="w-full text-left px-space-xs py-1 rounded hover:bg-surface-container font-mono text-body-sm"
      title={current ? `Set ${ago(current.updatedAt, now)} · click to replace` : "Click to set (stored encrypted)"}
      onClick={() => setDraft("")}
    >
      {current ? (
        <span className="text-on-surface-variant">
          •••••• <span className="text-outline font-body-sm text-body-sm">· {ago(current.updatedAt, now)}</span>
        </span>
      ) : (
        <span className="text-outline">— set</span>
      )}
    </button>
  );
}

/**
 * Test users of one environment: a table of users (rows) and their values (columns: login_id, password, tokens…),
 * the login request that signs a user in before they act, CSV import / export, and a way to move existing
 * environment variables into a user.
 */
export function TestUsersPanel({ environment, variables }: { environment: Environment; variables: Variable[] }) {
  const data = useTestUsers(environment);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ name: string; roles: string } | null>(null);
  const [column, setColumn] = useState<{ name: string; kind: ColumnKind } | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ name: string; roles: string; picked: string[] } | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<{ loginRequestId: string; sessionMinutes: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Column order just changed here (shown until the server's list catches up), and the column being dragged.
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<{ name: string; over: string | null } | null>(null);
  const env = ENVIRONMENT_LABELS[environment].label;

  useEffect(() => {
    fetchCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const act = async (key: string, action: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    setNotice(null);
    try {
      await action();
      testUsersChanged();
      if (ok) setNotice({ tone: "ok", text: ok });
    } catch (e) {
      setNotice({ tone: "error", text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const roles = (text: string) => text.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean);
  const badRole = (text: string) => roles(text).find((r) => !ROLE_NAME.test(r));

  if (!data) {
    return (
      <div className="flex items-center gap-space-xs text-outline font-body-sm text-body-sm">
        <Icon name="progress_activity" className="animate-spin text-body-md" /> Loading test users…
      </div>
    );
  }

  const sameSet = order !== null && order.length === data.columns.length && data.columns.every((c) => order.includes(c.name));
  const columns = sameSet ? order.map((n) => data.columns.find((c) => c.name === n)!) : data.columns;
  /** Moves a column to `to` (an index in the current order) and saves the new order. */
  const moveColumn = (name: string, to: number) => {
    const names = columns.map((c) => c.name);
    const from = names.indexOf(name);
    if (from < 0 || to < 0 || to >= names.length || from === to) return;
    names.splice(to, 0, ...names.splice(from, 1));
    setOrder(names);
    setBusy("order");
    reorderColumns(environment, names)
      .then(() => testUsersChanged())
      .catch((e: Error) => {
        setOrder(null); // back to the saved order
        setNotice({ tone: "error", text: `Could not reorder columns: ${e.message}` });
      })
      .finally(() => setBusy(null));
  };

  const settings = settingsDraft ?? { loginRequestId: data.settings.loginRequestId ?? "", sessionMinutes: data.settings.sessionMinutes };
  const requests = collections.flatMap((c) => c.requests.map((r) => ({ id: r.id, label: `${c.name} / ${r.name}`, method: r.method })));
  const loginRequest = requests.find((r) => r.id === data.settings.loginRequestId);

  return (
    <div className="flex flex-col gap-space-lg" data-testid="test-users">
      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-space-xs px-space-md py-space-sm rounded-lg font-body-sm text-body-sm ${
            notice.tone === "ok" ? "bg-primary/10 text-primary" : "bg-error-container/40 text-error"
          }`}
        >
          <Icon name={notice.tone === "ok" ? "check_circle" : "error"} className="text-body-md mt-0.5" />
          <span className="flex-1 whitespace-pre-line">{notice.text}</span>
          <button type="button" className="hover:text-on-surface" onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="close" className="text-body-md" />
          </button>
        </div>
      )}

      {/* How users log in */}
      <section className={`${CARD} p-space-lg grid grid-cols-1 xl:grid-cols-2 gap-space-lg`} aria-label="Automatic login">
        <div className="flex flex-col gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
            <Icon name="login" className="text-primary" /> Automatic login in {env}
          </h2>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Before a user acts in a flow (or a request is sent as them), Reqora sends this request as that user and reuses the login for the
            time below. After a 401 it logs them in again and retries once.
          </p>
          <div className="flex flex-wrap items-end gap-space-sm">
            <label className="flex flex-col gap-1 flex-1 min-w-64">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Login request</span>
              <select
                aria-label="Login request"
                className={FIELD}
                value={settings.loginRequestId}
                onChange={(e) => {
                  const loginRequestId = e.target.value;
                  setSettingsDraft((d) => ({ ...(d ?? settings), loginRequestId }));
                }}
              >
                <option value="">None — values are set by hand or by scripts</option>
                {requests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.method} {r.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 w-36">
              <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">Reuse login for</span>
              <span className="flex items-center gap-1">
                <input
                  aria-label="Session minutes"
                  type="number"
                  min={1}
                  max={1440}
                  className={`${FIELD} w-20`}
                  value={settings.sessionMinutes}
                  onChange={(e) => {
                    const sessionMinutes = Number(e.target.value) || 1;
                    setSettingsDraft((d) => ({ ...(d ?? settings), sessionMinutes }));
                  }}
                />
                <span className="font-body-sm text-body-sm text-outline">min</span>
              </span>
            </label>
            <button
              type="button"
              className={PRIMARY}
              disabled={!settingsDraft || busy === "settings"}
              onClick={() =>
                act(
                  "settings",
                  async () => {
                    await putUserSettings(environment, { loginRequestId: settings.loginRequestId || null, sessionMinutes: settings.sessionMinutes });
                    setSettingsDraft(null);
                  },
                  "Login settings saved. Users log in again before their next step.",
                )
              }
            >
              Save
            </button>
          </div>
          {loginRequest && !settingsDraft && (
            <span className="font-body-sm text-body-sm text-outline">
              Using <span className="text-on-surface">{loginRequest.label}</span>. Use “Log in now” on a user to check it.
            </span>
          )}
        </div>
        <div className="flex flex-col gap-space-xs">
          <span className="font-label-sm text-label-sm text-outline uppercase tracking-wider">In the login request</span>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Send the user&apos;s credentials with <span className="font-mono text-tertiary">{"{{user.login_id}}"}</span> and{" "}
            <span className="font-mono text-tertiary">{"{{user.password}}"}</span>, and save what the response returns to the user:
          </p>
          <pre className="p-space-sm rounded-lg bg-surface-container-lowest font-mono text-[11px] text-on-surface-variant whitespace-pre-wrap">{LOGIN_SCRIPT}</pre>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Every flow step then uses <span className="font-mono text-tertiary">{"{{user.access_token}}"}</span> of the user acting in it.
          </p>
        </div>
      </section>

      {/* Users */}
      <section className={CARD} aria-label="Test users">
        <div className="px-space-lg py-space-md flex flex-wrap items-center justify-between gap-space-sm">
          <h2 className="font-headline-sm text-headline-sm text-on-surface flex items-center gap-space-xs">
            <Icon name="group" className="text-primary" /> Test users in {env}
            <span className="font-label-sm text-label-sm text-outline">{data.users.length}</span>
          </h2>
          <div className="flex flex-wrap items-center gap-space-xs">
            <button type="button" className={PRIMARY} onClick={() => setAdding({ name: "", roles: "" })}>
              <Icon name="person_add" className="text-body-md" /> Add user
            </button>
            <button type="button" className={SECONDARY} onClick={() => setColumn({ name: "", kind: "plain" })}>
              <Icon name="view_column" className="text-body-md" /> Add column
            </button>
            <button type="button" className={SECONDARY} onClick={() => setImporting("user,roles,login_id,password\n")}>
              <Icon name="upload" className="text-body-md" /> Import CSV
            </button>
            <a className={SECONDARY} href={exportTestUsersUrl(environment)} download>
              <Icon name="download" className="text-body-md" /> Export CSV
            </a>
            {variables.length > 0 && (
              <button
                type="button"
                className={SECONDARY}
                title="Copy environment variables (like login_id and tokens) into a new test user"
                onClick={() => setMoving({ name: "user1", roles: "", picked: [] })}
              >
                <Icon name="move_down" className="text-body-md" /> From variables
              </button>
            )}
          </div>
        </div>

        {column && (
          <form
            className="mx-space-lg mb-space-sm flex flex-wrap items-center gap-space-xs p-space-sm rounded-lg bg-surface-container"
            onSubmit={(e) => {
              e.preventDefault();
              if (!VAR_NAME.test(column.name)) return setNotice({ tone: "error", text: "Column names use letters, digits and _" });
              void act("column", async () => {
                await putColumn(environment, column.name, column.kind);
                setColumn(null);
              });
            }}
          >
            <input autoFocus aria-label="Column name" placeholder="e.g. mbb_access_token" className={FIELD} value={column.name} onChange={(e) => {
              const name = e.target.value;
              setColumn((c) => c && { name, kind: SECRET_HINT.test(name) ? "secret" : c.kind });
            }} />
            <select aria-label="Column kind" className={FIELD} value={column.kind} onChange={(e) => {
              const kind = e.target.value as ColumnKind;
              setColumn((c) => c && { ...c, kind });
            }}>
              <option value="plain">Plain (readable)</option>
              <option value="secret">Secret (write-only, encrypted)</option>
            </select>
            <button type="submit" className={PRIMARY} disabled={busy === "column"}>
              Add column
            </button>
            <button type="button" className={SECONDARY} onClick={() => setColumn(null)}>
              Cancel
            </button>
          </form>
        )}

        <ScrollX>
          <table className="w-full min-w-max border-collapse">
            <thead>
              <tr className="font-label-sm text-label-sm text-outline uppercase tracking-wider text-left">
                <th className={`px-space-sm py-space-xs font-medium ${STICKY_LEFT}`}>User</th>
                <th className="px-space-sm py-space-xs font-medium">Roles</th>
                {columns.map((c, i) => (
                  <th
                    key={c.name}
                    data-column={c.name}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", c.name);
                      setDragging({ name: c.name, over: null });
                    }}
                    onDragOver={(e) => {
                      if (!dragging) return;
                      e.preventDefault();
                      if (dragging.over !== c.name) setDragging({ ...dragging, over: c.name });
                    }}
                    onDragLeave={() => dragging?.over === c.name && setDragging({ ...dragging, over: null })}
                    onDrop={(e) => {
                      e.preventDefault();
                      const name = dragging?.name ?? e.dataTransfer.getData("text/plain");
                      setDragging(null);
                      if (name) moveColumn(name, i);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`group px-space-sm py-space-xs font-medium cursor-grab active:cursor-grabbing ${
                      dragging?.name === c.name ? "opacity-40" : ""
                    } ${dragging && dragging.over === c.name && dragging.name !== c.name ? "bg-primary/10 shadow-[inset_2px_0_0_var(--color-primary)]" : ""}`}
                    title="Drag to reorder"
                  >
                    <span className="flex items-center gap-1 normal-case tracking-normal font-mono text-body-sm">
                      <Icon name="drag_indicator" className="text-body-md text-outline -ml-1 group-hover:text-on-surface" />
                      {c.name}
                      <button
                        type="button"
                        className={`px-1 rounded font-label-sm text-label-sm ${c.kind === "secret" ? "bg-tertiary/15 text-tertiary" : "bg-surface-container text-outline"}`}
                        title={c.kind === "secret" ? "Secret: encrypted, write-only — click to make it plain" : "Plain: readable — click to make it secret"}
                        onClick={() => {
                          const next = c.kind === "secret" ? "plain" : "secret";
                          if (next === "plain" && !window.confirm(`Make ${c.name} readable? Its values will show in this table.`)) return;
                          void act(`col:${c.name}`, () => putColumn(environment, c.name, next));
                        }}
                      >
                        {c.kind === "secret" ? "secret" : "plain"}
                      </button>
                      <span className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <button
                        type="button"
                        className={`${ICON_BTN} disabled:invisible`}
                        aria-label={`Move column ${c.name} left`}
                        title="Move left"
                        disabled={i === 0 || busy === "order"}
                        onClick={() => moveColumn(c.name, i - 1)}
                      >
                        <Icon name="chevron_left" className="text-body-sm" />
                      </button>
                      <button
                        type="button"
                        className={`${ICON_BTN} disabled:invisible`}
                        aria-label={`Move column ${c.name} right`}
                        title="Move right"
                        disabled={i === columns.length - 1 || busy === "order"}
                        onClick={() => moveColumn(c.name, i + 1)}
                      >
                        <Icon name="chevron_right" className="text-body-sm" />
                      </button>
                      </span>
                      <button
                        type="button"
                        className={ICON_BTN}
                        aria-label={`Delete column ${c.name}`}
                        title="Delete this column and every user's value in it"
                        onClick={() => {
                          if (window.confirm(`Delete ${c.name} for every user in ${env}?`)) void act(`col:${c.name}`, () => deleteColumn(environment, c.name));
                        }}
                      >
                        <Icon name="close" className="text-body-sm" />
                      </button>
                    </span>
                  </th>
                ))}
                <th className="px-space-sm py-space-xs font-medium">Session</th>
                <th className={STICKY_RIGHT} />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id} className="border-t border-outline-variant/15 align-middle hover:bg-surface-container/40" data-testid={`test-user-${u.name}`}>
                  <td className={`px-space-sm py-space-xs ${STICKY_LEFT}`}>
                    <input
                      aria-label={`Name of ${u.name}`}
                      className={`${FIELD} w-32 text-primary`}
                      defaultValue={u.name}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        if (name === u.name) return;
                        if (!USER_NAME.test(name)) {
                          e.target.value = u.name;
                          return setNotice({ tone: "error", text: "User names use letters, digits and . _ @ -" });
                        }
                        void act(`u:${u.id}`, () => patchTestUser(u.id, { name }));
                      }}
                    />
                  </td>
                  <td className="px-space-sm py-space-xs">
                    <input
                      aria-label={`Roles of ${u.name}`}
                      className={`${FIELD} w-40 text-secondary`}
                      placeholder="maker, authorizer"
                      defaultValue={u.roles.join(", ")}
                      onBlur={(e) => {
                        if (e.target.value.trim() === u.roles.join(", ")) return;
                        const bad = badRole(e.target.value);
                        if (bad) return setNotice({ tone: "error", text: `“${bad}” isn't a valid role (letters, digits, _ and -)` });
                        void act(`u:${u.id}`, () => patchTestUser(u.id, { roles: roles(e.target.value) }));
                      }}
                    />
                  </td>
                  {columns.map((c) => (
                    <td key={c.name} className="px-space-sm py-space-xs">
                      <ValueCell
                        user={u}
                        column={c}
                        now={now}
                        onSave={(value) => act(`u:${u.id}`, () => patchTestUser(u.id, { values: { [c.name]: value } }))}
                      />
                    </td>
                  ))}
                  <td className="px-space-sm py-space-xs whitespace-nowrap font-body-sm text-body-sm">
                    {u.sessionAt ? <span className="text-primary">logged in {ago(u.sessionAt, now)}</span> : <span className="text-outline">—</span>}
                  </td>
                  <td className={`px-space-sm py-space-xs ${STICKY_RIGHT}`}>
                    <div className="flex items-center justify-end gap-1">
                      {data.settings.loginRequestId && (
                        <button
                          type="button"
                          className={SECONDARY}
                          disabled={busy === `login:${u.id}`}
                          onClick={async () => {
                            setBusy(`login:${u.id}`);
                            try {
                              const result = await loginNow(u.id);
                              setNotice(
                                result.ok
                                  ? { tone: "ok", text: `${u.name} logged in (${result.status}, ${result.durationMs}ms)${result.saved.length ? ` — saved ${result.saved.join(", ")}` : " — the login script saved nothing (use rq.user.set)"}.` }
                                  : { tone: "error", text: `Login as ${u.name} failed: ${result.error}` },
                              );
                              testUsersChanged();
                            } catch (e) {
                              setNotice({ tone: "error", text: (e as Error).message });
                            } finally {
                              setBusy(null);
                            }
                          }}
                        >
                          <Icon name={busy === `login:${u.id}` ? "progress_activity" : "login"} className={`text-body-md ${busy === `login:${u.id}` ? "animate-spin" : ""}`} />
                          Log in now
                        </button>
                      )}
                      {u.sessionAt && (
                        <button type="button" className={ICON_BTN} title="End the session: the next step logs in again" onClick={() => act(`u:${u.id}`, () => logoutUser(u.id))}>
                          <Icon name="logout" className="text-body-md" />
                        </button>
                      )}
                      <button
                        type="button"
                        className={`${ICON_BTN} hover:text-error`}
                        aria-label={`Delete ${u.name}`}
                        onClick={() => {
                          if (window.confirm(`Delete test user ${u.name} from ${env}?`)) void act(`u:${u.id}`, () => deleteTestUser(u.id), `${u.name} deleted.`);
                        }}
                      >
                        <Icon name="delete" className="text-body-md" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {adding && (
                <tr className="border-t border-outline-variant/15">
                  <td className={`px-space-sm py-space-xs ${STICKY_LEFT}`}>
                    <input autoFocus aria-label="New user name" placeholder="maker01" className={`${FIELD} w-32`} value={adding.name} onChange={(e) => {
                      const name = e.target.value;
                      setAdding((a) => a && { ...a, name });
                    }} />
                  </td>
                  <td className="px-space-sm py-space-xs">
                    <input aria-label="New user roles" placeholder="maker" className={`${FIELD} w-40`} value={adding.roles} onChange={(e) => {
                      const roles = e.target.value;
                      setAdding((a) => a && { ...a, roles });
                    }} />
                  </td>
                  <td className="px-space-sm py-space-xs" colSpan={data.columns.length + 2}>
                    <div className="flex items-center gap-space-xs">
                      <button
                        type="button"
                        className={PRIMARY}
                        disabled={busy === "add"}
                        onClick={() => {
                          if (!USER_NAME.test(adding.name.trim())) return setNotice({ tone: "error", text: "User names use letters, digits and . _ @ -" });
                          const bad = badRole(adding.roles);
                          if (bad) return setNotice({ tone: "error", text: `“${bad}” isn't a valid role` });
                          void act("add", async () => {
                            await createTestUser(environment, { name: adding.name.trim(), roles: roles(adding.roles) });
                            setAdding(null);
                          });
                        }}
                      >
                        Add
                      </button>
                      <button type="button" className={SECONDARY} onClick={() => setAdding(null)}>
                        Cancel
                      </button>
                      <span className="font-body-sm text-body-sm text-outline">Fill in their values in the table after adding.</span>
                    </div>
                  </td>
                </tr>
              )}
              {data.users.length === 0 && !adding && (
                <tr>
                  <td colSpan={data.columns.length + 4} className="px-space-lg py-space-xl text-center font-body-sm text-body-sm text-on-surface-variant">
                    No test users in {env} yet. Add one, import a CSV, or move your current variables (like login_id and tokens) into a user with
                    “From variables”.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollX>
        <p className="px-space-lg py-space-sm font-body-sm text-body-sm text-outline">
          Roles say what a user can do (e.g. <span className="text-secondary">maker</span>, <span className="text-secondary">authorizer</span>): a flow
          step set to “Run as maker” uses a user with that role. Templates read the acting user with{" "}
          <span className="font-mono text-tertiary">{"{{user.NAME}}"}</span>; scripts save to them with{" "}
          <span className="font-mono text-tertiary">rq.user.set</span>. Drag a column header (or use its ‹ › buttons) to change the
          column order; CSV export follows it.
        </p>
      </section>

      {importing !== null && (
        <section className={`${CARD} p-space-lg flex flex-col gap-space-sm`} aria-label="Import CSV">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">Import users from CSV</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            First row: <span className="font-mono">user,roles,</span> then column names. Roles are separated by <span className="font-mono">;</span>.
            Existing users (same name) are updated; empty cells keep their value.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file"
            className="font-body-sm text-body-sm text-on-surface-variant"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) setImporting(await file.text());
            }}
          />
          <textarea aria-label="CSV" className={`${FIELD} min-h-40 font-mono`} value={importing} onChange={(e) => setImporting(e.target.value)} />
          <div className="flex items-center gap-space-xs">
            <button
              type="button"
              className={PRIMARY}
              disabled={busy === "import"}
              onClick={() =>
                act("import", async () => {
                  const result = await importTestUsers(environment, importing);
                  setImporting(null);
                  setNotice({
                    tone: result.errors.length ? "error" : "ok",
                    text: [`Imported: ${result.created} added, ${result.updated} updated.`, ...result.errors].join("\n"),
                  });
                })
              }
            >
              Import
            </button>
            <button type="button" className={SECONDARY} onClick={() => setImporting(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {moving && (
        <section className={`${CARD} p-space-lg flex flex-col gap-space-sm`} aria-label="From variables">
          <h3 className="font-headline-sm text-headline-sm text-on-surface">New user from {env} variables</h3>
          <p className="font-body-sm text-body-sm text-on-surface-variant">
            Copies the chosen variables into a new test user under the same names (secrets stay encrypted). The variables are kept; switch
            templates from <span className="font-mono text-tertiary">{"{{env.login_id}}"}</span> to{" "}
            <span className="font-mono text-tertiary">{"{{user.login_id}}"}</span> when you&apos;re ready.
          </p>
          <div className="flex flex-wrap gap-space-xs">
            <input aria-label="User name" className={`${FIELD} w-40`} value={moving.name} onChange={(e) => {
              const name = e.target.value;
              setMoving((m) => m && { ...m, name });
            }} />
            <input aria-label="Roles" placeholder="roles, e.g. maker" className={`${FIELD} w-48`} value={moving.roles} onChange={(e) => {
              const roles = e.target.value;
              setMoving((m) => m && { ...m, roles });
            }} />
          </div>
          <div className="flex flex-wrap gap-space-xs">
            {variables.map((v) => (
              <label key={v.name} className="flex items-center gap-1 px-space-xs py-0.5 rounded bg-surface-container font-mono text-body-sm text-on-surface cursor-pointer">
                <input
                  type="checkbox"
                  checked={moving.picked.includes(v.name)}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setMoving((m) => m && { ...m, picked: on ? [...m.picked, v.name] : m.picked.filter((n) => n !== v.name) });
                  }}
                />
                {v.name}
                {v.kind === "secret" && <Icon name="lock" className="text-body-sm text-tertiary" />}
              </label>
            ))}
          </div>
          <div className="flex items-center gap-space-xs">
            <button
              type="button"
              className={PRIMARY}
              disabled={!moving.picked.length || busy === "move"}
              onClick={() =>
                act(
                  "move",
                  async () => {
                    await userFromVariables(environment, { name: moving.name.trim(), roles: roles(moving.roles), variables: moving.picked });
                    setMoving(null);
                  },
                  `Created ${moving.name.trim()} from ${moving.picked.length} variable${moving.picked.length === 1 ? "" : "s"}.`,
                )
              }
            >
              Create user
            </button>
            <button type="button" className={SECONDARY} onClick={() => setMoving(null)}>
              Cancel
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
