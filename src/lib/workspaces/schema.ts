import { z } from "zod";

// Keep in sync with api/openapi.yaml.

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

/** owner: everything, including members and deleting the workspace; editor: change anything inside it; viewer: read only. */
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

export const ROLE_LABELS: Record<Role, { label: string; description: string }> = {
  owner: { label: "Owner", description: "Edits everything, manages members, renames or deletes the workspace" },
  editor: { label: "Editor", description: "Creates, edits, runs and deploys flows, collections and secrets" },
  viewer: { label: "Viewer", description: "Sees flows, collections, runs and telemetry; can't change or run anything" },
};

export const atLeast = (role: Role, need: Role) => ROLE_RANK[role] >= ROLE_RANK[need];

export type Workspace = {
  id: string;
  name: string;
  createdAt: string;
  /** The signed-in user's role in it. */
  role: Role;
  memberCount: number;
};

export type Member = { userId: string; name: string; email: string; role: Role; addedAt: string };

export const workspaceInputSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const memberInputSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(ROLES).default("editor"),
  /** For someone without an account yet: their name and a first password to share with them. */
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().max(1024).optional(),
});

export const memberRoleSchema = z.object({ role: z.enum(ROLES) });

/** Cookie holding the workspace the app shows; the X-Reqora-Workspace header overrides it for API clients. */
export const WORKSPACE_COOKIE = "reqora_workspace";
export const WORKSPACE_HEADER = "x-reqora-workspace";
