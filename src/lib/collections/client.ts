import { ApiError } from "@/lib/workflows/client";
import type { Environment } from "@/lib/workflows/schema";
import type {
  Collection,
  Example,
  ExampleResponse,
  Folder,
  RequestDefinition,
  SavedRequest,
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
export const updateCollection = (id: string, patch: { name?: string; description?: string | null }) =>
  request<Collection>(`/api/collections/${id}`, json("PATCH", patch));
export const deleteCollection = (id: string) => request<void>(`/api/collections/${id}`, { method: "DELETE" });

export const createFolder = (collectionId: string, name: string) =>
  request<Folder>(`/api/collections/${collectionId}/folders`, json("POST", { name }));
export const renameFolder = (id: string, name: string) => request<Folder>(`/api/folders/${id}`, json("PATCH", { name }));
export const deleteFolder = (id: string) => request<void>(`/api/folders/${id}`, { method: "DELETE" });

export const createRequest = (
  collectionId: string,
  input: { name: string; folderId?: string | null; definition?: RequestDefinition },
) => request<SavedRequest>(`/api/collections/${collectionId}/requests`, json("POST", input));
export const fetchRequest = (id: string) => request<SavedRequest>(`/api/requests/${id}`);
export const saveRequest = (id: string, input: { name: string; folderId: string | null; definition: RequestDefinition }) =>
  request<SavedRequest>(`/api/requests/${id}`, json("PUT", input));
export const deleteRequest = (id: string) => request<void>(`/api/requests/${id}`, { method: "DELETE" });

export const sendAdHoc = (definition: RequestDefinition, environment: Environment) =>
  request<SendOutcome>("/api/send", json("POST", { definition, environment }));

export const fetchExamples = (requestId: string) =>
  request<{ data: Example[] }>(`/api/requests/${requestId}/examples`).then((r) => r.data);
export const createExample = (requestId: string, name: string, response: ExampleResponse) =>
  request<Example>(`/api/requests/${requestId}/examples`, json("POST", { name, response }));
export const deleteExample = (id: string) => request<void>(`/api/examples/${id}`, { method: "DELETE" });

export const importCollection = (format: "curl" | "openapi", text: string, collectionId?: string) =>
  request<Collection>("/api/collections/import", json("POST", { format, text, collectionId }));
