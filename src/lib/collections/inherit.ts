import type { Auth, KeyValue, RequestDefinition, ScopeSettings } from "./schema";

export type Scope = "collection" | "folder" | "request";
type Named<T> = { name: string; settings: T };

export type EffectiveRequest = {
  /** Never "inherit": resolved request → folder → collection; an inheriting collection means no auth. */
  auth: Exclude<Auth, { type: "inherit" }>;
  authSource: Scope | null;
  /** Collection, then folder, then request headers; later entries win on the same name. */
  headers: (KeyValue & { scope: Scope })[];
  preScripts: { scope: Scope; name: string; code: string }[];
  postScripts: { scope: Scope; name: string; code: string }[];
};

/**
 * Postman-style inheritance. Scripts run outermost first (collection → folder → request) for both
 * phases; headers merge in the same order so the most specific level wins.
 */
export function resolveEffective(
  request: { name: string; definition: RequestDefinition },
  collection?: Named<ScopeSettings>,
  folder?: Named<ScopeSettings>,
): EffectiveRequest {
  const levels: { scope: Scope; name: string; auth: Auth; headers: KeyValue[]; pre: string; post: string }[] = [];
  if (collection) {
    const s = collection.settings;
    levels.push({ scope: "collection", name: collection.name, auth: s.auth, headers: s.headers, pre: s.preScript, post: s.postScript });
  }
  if (folder) {
    const s = folder.settings;
    levels.push({ scope: "folder", name: folder.name, auth: s.auth, headers: s.headers, pre: s.preScript, post: s.postScript });
  }
  const d = request.definition;
  levels.push({ scope: "request", name: request.name, auth: d.auth, headers: d.headers, pre: d.preScript, post: d.postScript });

  let auth: EffectiveRequest["auth"] = { type: "none" };
  let authSource: Scope | null = null;
  for (const level of [...levels].reverse()) {
    if (level.auth.type !== "inherit") {
      auth = level.auth;
      authSource = level.scope;
      break;
    }
  }

  return {
    auth,
    authSource: auth.type === "none" && authSource === null ? null : authSource,
    headers: levels.flatMap((l) => l.headers.map((h) => ({ ...h, scope: l.scope }))),
    preScripts: levels.filter((l) => l.pre.trim()).map((l) => ({ scope: l.scope, name: l.name, code: l.pre })),
    postScripts: levels.filter((l) => l.post.trim()).map((l) => ({ scope: l.scope, name: l.name, code: l.post })),
  };
}
