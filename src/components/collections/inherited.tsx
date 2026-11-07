"use client";

import { resolveEffective, type EffectiveRequest, type Scope } from "@/lib/collections/inherit";
import { folderChain } from "@/lib/collections/folders";
import { emptyDefinition, type Collection, type Folder, type KeyValue, type RequestDefinition, type ScopeSettings } from "@/lib/collections/schema";
import type { InheritSource } from "./auth-panel";

/** What a request (or a folder's own settings, treated as the innermost level) inherits from its parents. */
export type Inheritance = {
  effective: EffectiveRequest;
  /** Where inherited auth comes from when the innermost level says "inherit". */
  authSource: InheritSource | null;
  /** Headers set by outer levels only. */
  headers: (KeyValue & { scope: Scope })[];
  pre: { scope: Scope; name: string; code: string }[];
  post: { scope: Scope; name: string; code: string }[];
};

const outer = <T extends { scope: Scope }>(list: T[]) => list.filter((x) => x.scope !== "request");

export function inheritanceFor(
  name: string,
  definition: RequestDefinition,
  collection: Collection | undefined,
  folderId: string | null,
): Inheritance {
  const chain = collection ? folderChain(collection.folders, folderId) : [];
  const effective = resolveEffective({ name, definition }, collection, chain);
  const src = effective.authSource;
  // The innermost folder that sets auth is the one it came from.
  const authFolder = src === "folder" ? chain.findLast((f) => f.settings.auth.type !== "inherit") : undefined;
  const authSource: InheritSource | null =
    src === "collection" && collection
      ? { scope: "collection", id: collection.id, name: collection.name }
      : authFolder
        ? { scope: "folder", id: authFolder.id, name: authFolder.name }
        : null;
  return {
    effective,
    authSource,
    headers: outer(effective.headers),
    pre: outer(effective.preScripts),
    post: outer(effective.postScripts),
  };
}

/** A folder's settings as the innermost level under its collection and the folders above it. */
export function folderInheritance(folder: Folder, settings: ScopeSettings, collection: Collection | undefined): Inheritance {
  return inheritanceFor(folder.name, { ...emptyDefinition(), ...settings }, collection, folder.parentId);
}

const SCOPE_TONE: Record<Scope, string> = {
  collection: "bg-primary-container/20 text-primary",
  folder: "bg-tertiary-container/30 text-tertiary",
  request: "bg-surface-container-high text-on-surface-variant",
};

export function ScopeBadge({ scope, name }: { scope: Scope; name?: string }) {
  return (
    <span className={`px-1 rounded font-label-sm text-label-sm whitespace-nowrap ${SCOPE_TONE[scope]}`} title={name}>
      {scope}
    </span>
  );
}

/** Read-only list of headers set by parents; struck through when a more specific level sets the same name. */
export function InheritedHeaders({ inherited, own }: { inherited: (KeyValue & { scope: Scope })[]; own: KeyValue[] }) {
  const rows = inherited.filter((h) => h.enabled && h.key.trim());
  if (rows.length === 0) return null;
  const key = (k: string) => k.trim().toLowerCase();
  const ownNames = new Set(own.filter((h) => h.enabled && h.key.trim()).map((h) => key(h.key)));
  return (
    <div className="shrink-0 max-h-28 overflow-y-auto bg-surface-container-low/60 px-space-sm py-1" data-testid="inherited-headers">
      <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-0.5">Inherited headers</div>
      <table className="w-full table-fixed font-code-block text-code-block">
        <tbody>
          {rows.map((h, i) => {
            const overridden = ownNames.has(key(h.key)) || rows.slice(i + 1).some((later) => key(later.key) === key(h.key));
            return (
              <tr key={i} className={overridden ? "text-outline line-through" : "text-on-surface-variant"} title={overridden ? "Overridden by a more specific header" : undefined}>
                <td className="w-24 py-0.5 no-underline">
                  <ScopeBadge scope={h.scope} />
                </td>
                <td className="py-0.5 pr-space-sm truncate">{h.key}</td>
                <td className="py-0.5 truncate">{h.value}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
