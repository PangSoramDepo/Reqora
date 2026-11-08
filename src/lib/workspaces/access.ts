import "server-only";

import type { NextRequest } from "next/server";
import { sessionUser } from "@/lib/auth/session";
import type { User } from "@/lib/auth/store";
import { notFound, problem } from "@/lib/http";
import { atLeast, type Role, WORKSPACE_COOKIE, WORKSPACE_HEADER } from "./schema";
import { ensureWorkspace, roleIn } from "./store";

export type Access = { user: User; workspaceId: string; role: Role };
export type Checked = Access | { error: Response };

const DENIED: Record<Exclude<Role, "viewer">, string> = {
  editor: "you have view-only access to this workspace",
  owner: "only workspace owners can do this",
};

function check(user: User, workspaceId: string, role: Role, need: Role): Checked {
  if (!atLeast(role, need)) return { error: problem(403, "Forbidden", { detail: DENIED[need as Exclude<Role, "viewer">] }) };
  return { user, workspaceId, role };
}

/**
 * The workspace a list or create request works in: the X-Reqora-Workspace header, else the workspace chosen in
 * the app (cookie), else the user's first one. `need` is the least role the request requires.
 */
export function activeWorkspace(request: NextRequest, need: Role = "viewer"): Checked {
  const user = sessionUser(request);
  if (!user) return { error: problem(401, "Unauthorized", { detail: "sign in required" }) };
  const workspaces = ensureWorkspace(user);
  const header = request.headers.get(WORKSPACE_HEADER);
  if (header) {
    const chosen = workspaces.find((w) => w.id === header);
    return chosen ? check(user, chosen.id, chosen.role, need) : { error: notFound(`workspace "${header}"`) };
  }
  // A stale cookie (left the workspace, or it was deleted) falls back to the first workspace.
  const cookie = request.cookies.get(WORKSPACE_COOKIE)?.value;
  const chosen = workspaces.find((w) => w.id === cookie) ?? workspaces[0];
  return check(user, chosen.id, chosen.role, need);
}

/**
 * Access to one item, wherever it lives: the user must be a member of its workspace (`workspaceId`, undefined
 * when the item doesn't exist). Non-members get the same 404 as a missing item, so ids don't leak.
 */
export function accessTo(request: NextRequest, workspaceId: string | undefined, need: Role, what: string): Checked {
  const user = sessionUser(request);
  if (!user) return { error: problem(401, "Unauthorized", { detail: "sign in required" }) };
  const role = workspaceId === undefined ? undefined : roleIn(workspaceId, user.id);
  if (!role) return { error: notFound(what) };
  return check(user, workspaceId!, role, need);
}
