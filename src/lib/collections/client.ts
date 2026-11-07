import { ApiError } from "@/lib/workflows/client";
import type { SendRecord } from "./history";
import type { Environment, WorkflowNode } from "@/lib/workflows/schema";
import type {
  Collection,
  Example,
  ExampleResponse,
  Folder,
  RequestDefinition,
  SavedRequest,
  ScopeSettings,
  SendOutcome,
} from "./schema";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      detail?: string;
      title?: string;
      issues?: { path: string; message: string }[];
    };
    const issues = problem.issues?.map((i) => `${i.path}: ${i.message}`).join("; ");
    throw new ApiError(response.status, [problem.detail ?? problem.title ?? response.statusText, issues].filter(Boolean).join(" — "));
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const fetchCollections = () => request<{ data: Collection[] }>("/api/collections").then((r) => r.data);
export const createCollection = (name: string, description?: string) =>
  request<Collection>("/api/collections", json("POST", { name, description }));
export const updateCollection = (id: string, patch: { name?: string; description?: string | null; settings?: ScopeSettings }) =>
  request<Collection>(`/api/collections/${id}`, json("PATCH", patch));
export const deleteCollection = (id: string) => request<void>(`/api/collections/${id}`, { method: "DELETE" });
/** Copies a collection with its folders, requests and examples as "<name> Copy". */
export const duplicateCollection = (id: string) => request<Collection>(`/api/collections/${id}/duplicate`, { method: "POST" });

/** `parentId` creates a sub-folder inside that folder. */
export const createFolder = (collectionId: string, name: string, parentId: string | null = null) =>
  request<Folder>(`/api/collections/${collectionId}/folders`, json("POST", { name, parentId }));
export const renameFolder = (id: string, name: string) => request<Folder>(`/api/folders/${id}`, json("PATCH", { name }));
export const updateFolderSettings = (id: string, settings: ScopeSettings) =>
  request<Folder>(`/api/folders/${id}`, json("PATCH", { settings }));
/** Puts a folder at `index` among `parentId`'s sub-folders (null = top level). */
export const moveFolder = (id: string, index: number, parentId: string | null) =>
  request<Folder>(`/api/folders/${id}/move`, json("POST", { index, parentId }));
export const deleteFolder = (id: string) => request<void>(`/api/folders/${id}`, { method: "DELETE" });
/** Copies a folder with its requests as "<name> Copy", right after the original. */
export const duplicateFolder = (id: string) => request<Folder>(`/api/folders/${id}/duplicate`, { method: "POST" });

export const createRequest = (
  collectionId: string,
  input: { name: string; folderId?: string | null; definition?: RequestDefinition },
) => request<SavedRequest>(`/api/collections/${collectionId}/requests`, json("POST", input));
export const fetchRequest = (id: string) => request<SavedRequest>(`/api/requests/${id}`);
export const saveRequest = (id: string, input: { name: string; folderId: string | null; definition: RequestDefinition }) =>
  request<SavedRequest>(`/api/requests/${id}`, json("PUT", input));
/** Moves a request into a collection root (folderId null) or folder, at index among that container's requests. */
export const moveRequest = (id: string, target: { collectionId: string; folderId: string | null; index: number }) =>
  request<SavedRequest>(`/api/requests/${id}/move`, json("POST", target));
export const deleteRequest = (id: string) => request<void>(`/api/requests/${id}`, { method: "DELETE" });
/** Copies the saved version of a request (and its examples) as "<name> Copy", right after the original. */
export const duplicateRequest = (id: string) => request<SavedRequest>(`/api/requests/${id}/duplicate`, { method: "POST" });

/** Sends an unsaved definition; pass the location so collection/folder auth, headers and scripts apply. */
export const sendAdHoc = (
  definition: RequestDefinition,
  environment: Environment,
  location?: { collectionId: string; folderId: string | null; requestId?: string; name?: string },
) => request<SendOutcome>("/api/send", json("POST", { definition, environment, ...location }));

/** Recent Collections sends for the Live Execution Console. */
export const fetchRecentSends = (limit = 25) => request<{ data: SendRecord[] }>(`/api/sends?limit=${limit}`).then((r) => r.data);

/** Deletes the whole send log. */
export const clearRecentSends = () => request<{ deleted: number }>("/api/sends", { method: "DELETE" }).then((r) => r.deleted);

export type HttpNodeDraft = { name: string; config: Extract<WorkflowNode, { type: "http" }>["config"]; warnings: string[] };

/** Converts a request (saved by id, or unsaved with its location) into a workflow http node config. */
export const requestToNodeDraft = (
  input: { requestId: string } | { name: string; definition: RequestDefinition; collectionId?: string; folderId?: string | null },
) => request<HttpNodeDraft>("/api/requests/to-node", json("POST", input));

export const fetchExamples = (requestId: string) =>
  request<{ data: Example[] }>(`/api/requests/${requestId}/examples`).then((r) => r.data);
export const createExample = (requestId: string, name: string, response: ExampleResponse) =>
  request<Example>(`/api/requests/${requestId}/examples`, json("POST", { name, response }));
export const deleteExample = (id: string) => request<void>(`/api/examples/${id}`, { method: "DELETE" });

/** Download URL of a collection's `.reqora.json` export. */
export const collectionExportUrl = (id: string, format: "reqora" | "postman" = "reqora") =>
  `/api/collections/${id}/export${format === "postman" ? "?format=postman" : ""}`;

export type ImportResult = Collection & { importNotes?: string[] };
export const importCollection = (
  format: "curl" | "openapi" | "reqora" | "postman",
  text: string,
  collectionId?: string,
  variablesEnvironment?: Environment,
) => request<ImportResult>("/api/collections/import", json("POST", { format, text, collectionId, variablesEnvironment }));
