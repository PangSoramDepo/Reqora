import { z } from "zod";
import { environmentSchema } from "@/lib/workflows/schema";

// Keep in sync with api/openapi.yaml (RequestDefinition, Assertion, SendResult…).

export const REQUEST_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;
export type RequestMethod = (typeof REQUEST_METHODS)[number];

const template = (max = 4000) => z.string().max(max);

export const keyValueSchema = z.object({
  key: z.string().max(500),
  value: template(),
  enabled: z.boolean().default(true),
});

export const authSchema = z.discriminatedUnion("type", [
  /** Use the folder's auth, else the collection's (Postman's "Inherit auth from parent"). */
  z.object({ type: z.literal("inherit") }),
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("bearer"), token: template() }),
  z.object({ type: z.literal("basic"), username: template(), password: template() }),
  z.object({ type: z.literal("apiKey"), header: z.string().max(200), value: template() }),
]);

export const bodySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("json"), text: template(100_000) }),
  z.object({ type: z.literal("text"), text: template(100_000) }),
]);

export const assertionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status"), equals: z.number().int().min(100).max(599) }),
  z.object({ type: z.literal("responseTimeBelow"), ms: z.number().int().min(1).max(600_000) }),
  z.object({ type: z.literal("headerContains"), header: z.string().min(1).max(200), value: z.string().max(2000) }),
  z.object({ type: z.literal("bodyContains"), text: z.string().max(2000) }),
  z.object({ type: z.literal("jsonPathEquals"), path: z.string().min(1).max(500), value: z.string().max(2000) }),
  z.object({ type: z.literal("jsonPathExists"), path: z.string().min(1).max(500) }),
]);

const script = z.string().max(50_000);

export const settingsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
  followRedirects: z.boolean().default(true),
});

export const requestDefinitionSchema = z.object({
  method: z.enum(REQUEST_METHODS).default("GET"),
  url: template(2000).default(""),
  params: z.array(keyValueSchema).max(100).default([]),
  headers: z.array(keyValueSchema).max(100).default([]),
  auth: authSchema.default({ type: "inherit" }),
  body: bodySchema.default({ type: "none" }),
  assertions: z.array(assertionSchema).max(50).default([]),
  /** JavaScript run in a sandbox before sending (after the collection's and folder's scripts). */
  preScript: script.default(""),
  /** JavaScript run after the response arrives (after the collection's and folder's scripts). */
  postScript: script.default(""),
  settings: settingsSchema.default({ timeoutMs: 10_000, followRedirects: true }),
});

/** Auth, headers and scripts shared by every request in a collection or folder. */
export const scopeSettingsSchema = z.object({
  auth: authSchema.default({ type: "inherit" }),
  headers: z.array(keyValueSchema).max(100).default([]),
  preScript: script.default(""),
  postScript: script.default(""),
});
export type ScopeSettings = z.infer<typeof scopeSettingsSchema>;
export const emptyScopeSettings = (): ScopeSettings => scopeSettingsSchema.parse({});

export type KeyValue = z.infer<typeof keyValueSchema>;
export type Auth = z.infer<typeof authSchema>;
export type Body = z.infer<typeof bodySchema>;
export type Assertion = z.infer<typeof assertionSchema>;
export type RequestSettings = z.infer<typeof settingsSchema>;
export type RequestDefinition = z.infer<typeof requestDefinitionSchema>;

export const emptyDefinition = (): RequestDefinition => requestDefinitionSchema.parse({});

const name = z.string().trim().min(1).max(120);
const id = z.string().min(1).max(100);

export const collectionInputSchema = z.object({ name, description: z.string().max(2000).optional() });
export const collectionPatchSchema = z
  .object({
    name: name.optional(),
    description: z.string().max(2000).nullable().optional(),
    settings: scopeSettingsSchema.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.settings !== undefined, "provide name, description and/or settings");

export const folderInputSchema = z.object({ name });
export const folderPatchSchema = z
  .object({ name: name.optional(), settings: scopeSettingsSchema.optional() })
  .refine((v) => v.name !== undefined || v.settings !== undefined, "provide name and/or settings");

/** Move a request to a position within a collection (root when folderId is null) or a folder. */
export const requestMoveSchema = z.object({
  collectionId: id,
  folderId: id.nullable(),
  index: z.number().int().min(0),
});
export const folderMoveSchema = z.object({ index: z.number().int().min(0) });

export const requestCreateSchema = z.object({
  name,
  folderId: id.nullable().optional(),
  definition: requestDefinitionSchema.optional(),
});
export const requestReplaceSchema = z.object({
  name,
  folderId: id.nullable(),
  definition: requestDefinitionSchema,
});

export const sendInputSchema = z.object({
  definition: requestDefinitionSchema,
  environment: environmentSchema.default("production"),
  /** Where the (possibly unsaved) request lives, so collection/folder auth, headers and scripts apply. */
  collectionId: id.optional(),
  folderId: id.nullable().optional(),
  /** The saved request being edited, if any, and its (possibly edited) name — for scripts' labels and history. */
  requestId: id.optional(),
  name: z.string().trim().min(1).max(200).optional(),
});

/** Convert a request into a workflow http node config, saved (requestId) or unsaved (definition + location). */
export const toNodeInputSchema = z.union([
  z.object({ requestId: id }),
  z.object({ name, definition: requestDefinitionSchema, collectionId: id.optional(), folderId: id.nullable().optional() }),
]);

export const importInputSchema = z.object({
  /** `reqora`: a collection exported from Reqora (lossless). `postman`: a Postman Collection v2.0/v2.1. */
  format: z.enum(["curl", "openapi", "reqora", "postman"]),
  /** postman only: add the collection's variables to this environment (existing values are kept). */
  variablesEnvironment: environmentSchema.optional(),
  text: z.string().min(1).max(2_000_000),
  /** cURL only: add the request to this existing collection instead of creating one. */
  collectionId: id.optional(),
});

export type AssertionResult = { assertion: Assertion; passed: boolean; actual?: string };

export type ScriptLog = { level: "log" | "info" | "warn" | "error"; message: string; scope: "collection" | "folder" | "request"; source: string };
export type ScriptTestResult = { name: string; passed: boolean; error?: string; scope: "collection" | "folder" | "request"; source: string };
export type ScriptErrorInfo = { phase: "pre" | "post"; scope: "collection" | "folder" | "request"; source: string; message: string };

/** What the scripts did during a send. */
export type ScriptReport = {
  logs: ScriptLog[];
  tests: ScriptTestResult[];
  errors: ScriptErrorInfo[];
  /** Variables after all scripts ran (usable as {{vars.NAME}} in this request). */
  variables: Record<string, string>;
  /** Environment changes from rq.environment.set / unset (null = unset), saved to the selected environment. */
  environment?: Record<string, string | null>;
};

/** The request exactly as it went on the wire (after scripts, templates and auth). Scrubbed in API responses; real values in the send history. */
export type SentRequest = { method: string; url: string; headers: Record<string, string>; body?: string };

export type SendResult = {
  request: SentRequest;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Parsed JSON when the response is JSON, otherwise text. */
  body: unknown;
  size: number;
  durationMs: number;
  url: string;
  assertions: AssertionResult[];
  scripts: ScriptReport;
};

/** Network failure, timeout, or template error — no HTTP response was received. */
export type SendFailure = { error: string; url?: string; request?: SentRequest; durationMs: number; scripts?: ScriptReport };
export type SendOutcome = SendResult | SendFailure;

export type RequestSummary = { id: string; name: string; method: RequestMethod; url: string; folderId: string | null };
export type Folder = { id: string; collectionId: string; name: string; position: number; settings: ScopeSettings };

export type Collection = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  settings: ScopeSettings;
  folders: Folder[];
  requests: RequestSummary[];
};

export type SavedRequest = {
  id: string;
  collectionId: string;
  folderId: string | null;
  name: string;
  position: number;
  definition: RequestDefinition;
  createdAt: string;
  updatedAt: string;
};

export type ExampleResponse = Pick<SendResult, "status" | "statusText" | "headers" | "body" | "size" | "durationMs">;

export const exampleInputSchema = z.object({
  name,
  response: z.object({
    status: z.number().int().min(100).max(599),
    statusText: z.string().max(200).default(""),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.unknown(),
    size: z.number().int().min(0).default(0),
    durationMs: z.number().min(0).default(0),
  }),
});

export type Example = { id: string; requestId: string; name: string; status: number; response: ExampleResponse; createdAt: string };

const exportedRequestSchema = z.object({
  name,
  definition: requestDefinitionSchema,
  examples: z.array(exampleInputSchema).max(100).default([]),
});

/**
 * A collection exported from Reqora: settings (auth, headers, scripts), folders with their settings, and every
 * request in order with its examples. Ids are not kept; importing creates a new collection. Environment
 * variables and secrets are not included.
 */
export const collectionExportSchema = z.object({
  reqora: z.literal("collection"),
  version: z.literal(1),
  exportedAt: z.string().optional(),
  collection: z.object({
    name,
    description: z.string().max(2000).optional(),
    settings: scopeSettingsSchema.default(emptyScopeSettings),
    folders: z
      .array(z.object({ name, settings: scopeSettingsSchema.default(emptyScopeSettings), requests: z.array(exportedRequestSchema).max(1000) }))
      .max(200)
      .default([]),
    /** Requests at the collection root. */
    requests: z.array(exportedRequestSchema).max(1000).default([]),
  }),
});
export type CollectionExport = z.infer<typeof collectionExportSchema>;
