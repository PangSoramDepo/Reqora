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

export const settingsSchema = z.object({
  timeoutMs: z.number().int().min(100).max(30_000).default(10_000),
  followRedirects: z.boolean().default(true),
});

export const requestDefinitionSchema = z.object({
  method: z.enum(REQUEST_METHODS).default("GET"),
  url: template(2000).default(""),
  params: z.array(keyValueSchema).max(100).default([]),
  headers: z.array(keyValueSchema).max(100).default([]),
  auth: authSchema.default({ type: "none" }),
  body: bodySchema.default({ type: "none" }),
  assertions: z.array(assertionSchema).max(50).default([]),
  settings: settingsSchema.default({ timeoutMs: 10_000, followRedirects: true }),
});

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
  .object({ name: name.optional(), description: z.string().max(2000).nullable().optional() })
  .refine((v) => v.name !== undefined || v.description !== undefined, "provide name and/or description");

export const folderInputSchema = z.object({ name });
export const folderPatchSchema = z.object({ name });

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
});

export const importInputSchema = z.object({
  format: z.enum(["curl", "openapi"]),
  text: z.string().min(1).max(2_000_000),
  /** cURL only: add the request to this existing collection instead of creating one. */
  collectionId: id.optional(),
});

export type AssertionResult = { assertion: Assertion; passed: boolean; actual?: string };

export type SendResult = {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  /** Parsed JSON when the response is JSON, otherwise text. */
  body: unknown;
  size: number;
  durationMs: number;
  url: string;
  assertions: AssertionResult[];
};

/** Network failure, timeout, or template error — no HTTP response was received. */
export type SendFailure = { error: string; url?: string; durationMs: number };
export type SendOutcome = SendResult | SendFailure;

export type RequestSummary = { id: string; name: string; method: RequestMethod; url: string; folderId: string | null };
export type Folder = { id: string; collectionId: string; name: string; position: number };

export type Collection = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
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
