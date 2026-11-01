import { ApiError, fetchWorkflow, saveWorkflow } from "@/lib/workflows/client";
import type { Workflow } from "@/lib/workflows/schema";

export type SaveState = { kind: "saved" | "saving" | "unsaved" } | { kind: "error"; message: string };

type AutosaverOptions = {
  /** Called whenever the authoritative local copy changes (edits, new versions, reloads). */
  onChange: (workflow: Workflow) => void;
  onState: (state: SaveState) => void;
  debounceMs?: number;
};

/**
 * Owns the latest local copy of a workflow and saves it: debounced, one request at a time, with
 * optimistic concurrency. Edits made while a save is in flight trigger a follow-up save; a 409
 * reloads the server copy.
 */
export function createAutosaver({ onChange, onState, debounceMs = 600 }: AutosaverOptions) {
  let latest: Workflow | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let editSeq = 0;

  const set = (workflow: Workflow) => {
    latest = workflow;
    onChange(workflow);
  };

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (inFlight) {
      await inFlight;
      return flush();
    }
    if (!latest) return;

    const sent = latest;
    const sentSeq = editSeq;
    onState({ kind: "saving" });
    inFlight = saveWorkflow(sent)
      .then((saved) => {
        // Adopt the new version without discarding edits made while the request was in flight.
        if (latest) set({ ...latest, version: saved.version, updatedAt: saved.updatedAt });
        if (editSeq === sentSeq) onState({ kind: "saved" });
        else schedule(debounceMs);
      })
      .catch(async (error: Error) => {
        if (error instanceof ApiError && error.status === 409) {
          set(await fetchWorkflow(sent.id));
          onState({ kind: "error", message: "Edited elsewhere — reloaded the latest version" });
        } else {
          onState({ kind: "error", message: error.message });
        }
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  function schedule(delay: number) {
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), delay);
  }

  return {
    current: () => latest,
    /** Adopt a workflow loaded from the server; nothing to save. */
    load(workflow: Workflow) {
      editSeq = 0;
      set(workflow);
    },
    /**
     * Apply a local change. With `save: false` the change is kept locally (e.g. mid-drag) and goes out
     * with the next save.
     */
    update(fn: (workflow: Workflow) => Workflow, { save = true, immediate = false } = {}) {
      if (!latest) return;
      set(fn(latest));
      if (!save) return;
      editSeq += 1;
      onState({ kind: "unsaved" });
      schedule(immediate ? 0 : debounceMs);
    },
    flush,
    dispose: () => clearTimeout(timer),
  };
}
