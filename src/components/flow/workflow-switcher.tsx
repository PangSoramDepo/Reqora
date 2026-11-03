"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { createWorkflow, deleteWorkflow, fetchWorkflowSummaries } from "@/lib/workflows/client";
import type { Workflow, WorkflowSummary } from "@/lib/workflows/schema";
import { blankWorkflow } from "@/lib/workflows/templates";

type WorkflowSwitcherProps = {
  workflow: Workflow;
  onRename: (name: string) => void;
  onError: (message: string) => void;
};

const ITEM = "w-full flex items-center gap-space-xs px-space-sm py-space-xs rounded text-left hover:bg-surface-container-high";

export function WorkflowSwitcher({ workflow, onRename, onError }: WorkflowSwitcherProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(workflow.name);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    fetchWorkflowSummaries()
      .then(setWorkflows)
      .catch((e: Error) => onError(e.message));
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open, onError]);

  const commitRename = () => {
    const name = draftName.trim();
    if (name && name !== workflow.name) onRename(name);
    setRenaming(false);
  };

  const create = async () => {
    try {
      const created = await createWorkflow(blankWorkflow(`Untitled Workflow ${workflows.length + 1}`));
      setOpen(false);
      router.push(`/flow/${created.id}`);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${workflow.name}" and all of its run history? This can't be undone.`)) return;
    try {
      await deleteWorkflow(workflow.id);
      setOpen(false);
      router.replace("/flow");
    } catch (e) {
      onError((e as Error).message);
    }
  };

  if (renaming) {
    return (
      <input
        autoFocus
        aria-label="Workflow name"
        className="bg-surface-container-lowest rounded px-space-xs py-space-xxs font-label-md text-label-md text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/50 min-w-0 w-64"
        maxLength={120}
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") {
            setDraftName(workflow.name);
            setRenaming(false);
          }
        }}
      />
    );
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        aria-expanded={open}
        className="flex items-center gap-space-xxs font-label-md text-label-md text-primary min-w-0 hover:text-primary-fixed"
        onClick={() => setOpen((o) => !o)}
        onDoubleClick={() => {
          setDraftName(workflow.name);
          setRenaming(true);
        }}
        title="Switch workflow (double-click to rename)"
        type="button"
      >
        <span className="truncate">FLOW GRAPH: {workflow.name.toUpperCase()}</span>
        <Icon name="expand_more" className="text-body-md shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-space-xs w-80 max-h-96 overflow-y-auto z-50 p-space-xs rounded-xl bg-surface-container-high shadow-[0_16px_32px_-8px_rgba(0,0,0,0.6)] border border-outline-variant/30 font-body-sm text-body-sm">
          <div className="px-space-sm py-space-xxs font-label-sm text-label-sm text-outline uppercase tracking-wider">Workflows</div>
          {workflows.map((wf) => (
            <button
              key={wf.id}
              className={`${ITEM} ${wf.id === workflow.id ? "text-primary" : "text-on-surface"}`}
              onClick={() => {
                setOpen(false);
                if (wf.id !== workflow.id) router.push(`/flow/${wf.id}`);
              }}
              type="button"
            >
              <Icon name={wf.id === workflow.id ? "radio_button_checked" : "schema"} className="text-body-md shrink-0" />
              <span className="flex-1 truncate">{wf.name}</span>
              <span className="font-mono text-label-sm text-outline shrink-0">
                {wf.nodeCount} nodes · {wf.deployment ? `live v${wf.deployment.version}` : "draft"}
              </span>
            </button>
          ))}
          <div className="h-px bg-outline-variant/30 my-space-xs" />
          <button className={`${ITEM} text-primary`} onClick={create} type="button">
            <Icon name="add" className="text-body-md" /> New workflow
          </button>
          <button
            className={`${ITEM} text-on-surface`}
            onClick={() => {
              setOpen(false);
              setDraftName(workflow.name);
              setRenaming(true);
            }}
            type="button"
          >
            <Icon name="edit" className="text-body-md" /> Rename “{workflow.name}”
          </button>
          <button className={`${ITEM} text-error`} onClick={remove} type="button">
            <Icon name="delete" className="text-body-md" /> Delete workflow
          </button>
        </div>
      )}
    </div>
  );
}
