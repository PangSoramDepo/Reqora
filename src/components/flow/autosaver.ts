import { ApiError, fetchWorkflow, saveWorkflow } from "@/lib/workflows/client";
import type { Workflow } from "@/lib/workflows/schema";

export type SaveState = { kind: "saved" | "saving" | "unsaved" } | { kind: "error"; message: string };

/** What undo / redo would do next (labels describe the step, e.g. "Auto align"). */
export type HistoryState = { undo?: string; redo?: string };

type AutosaverOptions = {
  /** Called whenever the authoritative local copy changes (edits, new versions, reloads). */
  onChange: (workflow: Workflow) => void;
  onState: (state: SaveState) => void;
  onHistory?: (history: HistoryState) => void;
  debounceMs?: number;
};

export type UpdateOptions = {
  /** false: keep the change local (e.g. mid-drag); it goes out, and into undo history, with the next save. */
  save?: boolean;
  immediate?: boolean;
  /** Names the undo step. */
  label?: string;
  /** Consecutive edits with the same group (e.g. typing in one node's fields) become one undo step. */
  group?: string;
  /** false: not an undoable step (e.g. refreshing a linked node's copy). */
  track?: boolean;
};

/** The parts of a workflow that undo / redo restore. */
type Snapshot = Pick<Workflow, "name" | "description" | "nodes" | "edges">;
const snapshot = (w: Workflow): Snapshot => ({ name: w.name, description: w.description, nodes: w.nodes, edges: w.edges });
const sameSnapshot = (a: Snapshot, b: Snapshot) => JSON.stringify(a) === JSON.stringify(b);
const MAX_HISTORY = 100;
const GROUP_MS = 1500;

/**
 * Owns the latest local copy of a workflow and saves it: debounced, one request at a time, with
 * optimistic concurrency. Edits made while a save is in flight trigger a follow-up save; a 409
 * reloads the server copy.
 */
export function createAutosaver({ onChange, onState, onHistory, debounceMs = 600 }: AutosaverOptions) {
  let latest: Workflow | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let editSeq = 0;

  // Undo history: `committed` is the graph after the last recorded step; each step stores the graph before it.
  let committed: Snapshot | null = null;
  let undoStack: { snapshot: Snapshot; label: string }[] = [];
  let redoStack: { snapshot: Snapshot; label: string }[] = [];
  let lastGroup: { key: string; at: number } | null = null;

  const set = (workflow: Workflow) => {
    latest = workflow;
    onChange(workflow);
  };
  const announce = () => onHistory?.({ undo: undoStack.at(-1)?.label, redo: redoStack.at(-1)?.label });
  const resetHistory = (workflow: Workflow) => {
    committed = snapshot(workflow);
    undoStack = [];
    redoStack = [];
    lastGroup = null;
    announce();
  };

  /** Records the change from `committed` to the current graph as an undo step. */
  function record({ label = "Edit", group, track = true }: UpdateOptions) {
    if (!latest) return;
    const now = snapshot(latest);
    if (track && committed && !sameSnapshot(committed, now)) {
      const merge = group !== undefined && lastGroup?.key === group && Date.now() - lastGroup.at < GROUP_MS;
      if (!merge) {
        undoStack.push({ snapshot: committed, label });
        if (undoStack.length > MAX_HISTORY) undoStack.shift();
      }
      redoStack = [];
    }
    committed = now;
    lastGroup = track && group !== undefined ? { key: group, at: Date.now() } : null;
    announce();
  }

  function markEdited(immediate: boolean) {
    editSeq += 1;
    onState({ kind: "unsaved" });
    schedule(immediate ? 0 : debounceMs);
  }

  /** Restores a snapshot from one stack, pushing the current graph onto the other. Returns the step's label. */
  function travel(from: typeof undoStack, to: typeof undoStack): string | undefined {
    const entry = from.pop();
    if (!entry || !latest) return undefined;
    to.push({ snapshot: snapshot(latest), label: entry.label });
    set({ ...latest, ...entry.snapshot });
    committed = entry.snapshot;
    lastGroup = null;
    announce();
    markEdited(true);
    return entry.label;
  }

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
          const fresh = await fetchWorkflow(sent.id);
          set(fresh);
          // Earlier steps no longer apply to someone else's version.
          resetHistory(fresh);
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
      resetHistory(workflow);
    },
    /**
     * Apply a local change. With `save: false` the change is kept locally (e.g. mid-drag) and goes out — and into
     * the undo history — with the next save.
     */
    update(fn: (workflow: Workflow) => Workflow, options: UpdateOptions = {}) {
      if (!latest) return;
      set(fn(latest));
      if (options.save === false) return;
      record(options);
      markEdited(options.immediate ?? false);
    },
    /** Reverts the last step; returns its label (undefined when there's nothing to undo). */
    undo: () => travel(undoStack, redoStack),
    /** Re-applies the last undone step; returns its label. */
    redo: () => travel(redoStack, undoStack),
    flush,
    dispose: () => clearTimeout(timer),
  };
}
