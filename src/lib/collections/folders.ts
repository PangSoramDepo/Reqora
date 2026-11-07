/** Folder tree helpers shared by the server and the explorer. Folders nest through `parentId` (null = top level). */
type TreeFolder = { id: string; parentId: string | null; name: string };

/** The folder and its ancestors, outermost first (empty when the id is null or unknown). */
export function folderChain<F extends TreeFolder>(folders: F[], folderId: string | null | undefined): F[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: F[] = [];
  const seen = new Set<string>();
  for (let f = folderId ? byId.get(folderId) : undefined; f && !seen.has(f.id); f = f.parentId ? byId.get(f.parentId) : undefined) {
    seen.add(f.id);
    chain.unshift(f);
  }
  return chain;
}

/** "Parent / Child" for display. */
export const folderPath = (folders: TreeFolder[], folderId: string | null | undefined) =>
  folderChain(folders, folderId)
    .map((f) => f.name)
    .join(" / ");

/** The folder's id and the ids of every folder inside it, at any depth. */
export function subtreeIds(folders: TreeFolder[], folderId: string): Set<string> {
  const ids = new Set([folderId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of folders) {
      if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
        ids.add(f.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Folders in tree order (each folder followed by its sub-folders), with their depth. */
export function flattenTree<F extends TreeFolder>(folders: F[]): { folder: F; depth: number }[] {
  const out: { folder: F; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const f of folders.filter((x) => x.parentId === parentId)) {
      out.push({ folder: f, depth });
      visit(f.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
