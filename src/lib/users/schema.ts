import { z } from "zod";
import { VARIABLE_NAME } from "@/lib/workflows/schema";

// Keep in sync with api/openapi.yaml.

/** A test user's name: letters, digits and . _ @ -, e.g. maker01 or ann@bank.test. */
export const USER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.@-]{0,63}$/;
/** A role (and the tag users carry for it), e.g. maker or authorizer. */
export const ROLE_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;
/** The role of flows that don't name their roles: "the" test user. */
export const DEFAULT_ROLE = "user";
/** Names that look like credentials are secret by default. */
export const SECRET_HINT = /SECRET|TOKEN|KEY|PASSWORD|PASS|CREDENTIAL|PRIVATE/i;

export type ColumnKind = "secret" | "plain";
export type TestUserColumn = { name: string; kind: ColumnKind };
/** A value as the API shows it: secrets are write-only (null), with when they were last set. */
export type TestUserValue = { value: string | null; updatedAt: string };

export type TestUser = {
  id: string;
  name: string;
  roles: string[];
  /** When the automatic login last succeeded for this user (null: never, or logged out). */
  sessionAt: string | null;
  values: Record<string, TestUserValue>;
  createdAt: string;
  updatedAt: string;
};

export type TestUserSettings = {
  /** Saved Collections request sent to log a user in before they act (null: no automatic login). */
  loginRequestId: string | null;
  /** A login is reused for this long, then done again before the user's next step. */
  sessionMinutes: number;
};

export type TestUsersResponse = { environment: string; users: TestUser[]; columns: TestUserColumn[]; settings: TestUserSettings };

const role = z.string().regex(ROLE_NAME, "letters, digits, _ and -, starting with a letter (max 32)");
const valueName = z.string().regex(VARIABLE_NAME, "letters, digits and _, not starting with a digit (max 64)");

export const userInputSchema = z.object({
  name: z.string().trim().regex(USER_NAME, "letters, digits and . _ @ - (max 64)"),
  roles: z.array(role).max(10).default([]),
  /** Column values; null clears one. New names become columns (secret when the name looks like a credential). */
  values: z.record(valueName, z.string().max(10_000).nullable()).default({}),
});
/** Only what's given changes (no defaults here: `.partial()` would still apply roles: [] and clear them). */
export const userPatchSchema = z.object({
  name: userInputSchema.shape.name.optional(),
  roles: z.array(role).max(10).optional(),
  values: z.record(valueName, z.string().max(10_000).nullable()).optional(),
});
export const columnInputSchema = z.object({ kind: z.enum(["secret", "plain"]) });
export const settingsInputSchema = z.object({
  loginRequestId: z.string().min(1).max(100).nullable(),
  sessionMinutes: z.number().int().min(1).max(1440).default(30),
});
export const importInputSchema = z.object({ csv: z.string().max(1_000_000) });
export const fromVariablesSchema = z.object({
  name: z.string().trim().regex(USER_NAME),
  roles: z.array(role).max(10).default([]),
  /** Environment variables to copy into the new user (same names). */
  variables: z.array(valueName).min(1).max(100),
});

/**
 * The user acting in a run step or a send: `{{user.NAME}}` reads `get`, `rq.user.set` writes `set` (saved to the
 * user right away).
 */
export type UserHandle = {
  id: string;
  name: string;
  roles: string[];
  /** The flow role this user plays in the current step. */
  role: string;
  get: (name: string) => string | undefined;
  set: (name: string, value: string | null) => void;
};

/** A flow's roles; flows that don't name any have the one default role. */
export const flowRoles = (roles: readonly string[] | undefined): string[] => (roles?.length ? [...roles] : [DEFAULT_ROLE]);

/** Who plays each role in a run: role → user id or name (missing roles are filled in automatically). */
export const userAssignmentSchema = z.record(role, z.string().min(1).max(100));
