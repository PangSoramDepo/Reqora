"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTestUsers } from "@/lib/users/client";
import { fetchVariables } from "@/lib/workflows/client";
import type { Environment, Step, Workflow } from "@/lib/workflows/schema";
import { outputShape, type DataSource } from "@/lib/workflows/template-suggest";

/** Inserts text at the caret of the template field that had focus last. */
type Inserter = (text: string) => boolean;

type TemplateData = {
  sources: DataSource[];
  env: string[];
  /** Value names of the environment's test users ({{user.NAME}}). */
  user: string[];
  /** True when there's a run to preview with. */
  hasRun: boolean;
  /** The template field that had focus last registers here, so picking data inserts into it. */
  setTarget: (insert: Inserter | null) => void;
  /** Inserts into the last focused template field; false when there's none. */
  insert: (text: string) => boolean;
};

const Context = createContext<TemplateData | null>(null);

/** Template data for the node being edited (null outside the Flow Canvas inspector). */
export const useTemplateData = () => useContext(Context);

/** Nodes the given node runs after: what its templates can read. */
function ancestors(workflow: Workflow, nodeId: string): Set<string> {
  const found = new Set<string>();
  const visit = (id: string) => {
    for (const edge of workflow.edges) {
      if (edge.target === id && !found.has(edge.source)) {
        found.add(edge.source);
        visit(edge.source);
      }
    }
  };
  visit(nodeId);
  return found;
}

/**
 * Provides what the inspector's template fields can reference: the trigger payload and every node that runs
 * before `nodeId` (with the last run's output, or the type's output fields), plus this node itself (a
 * "repeat until" condition reads its own response), and the environment's variable names.
 */
export function TemplateDataProvider({
  workflow,
  nodeId,
  steps,
  triggerBody,
  environment,
  children,
}: {
  workflow: Workflow;
  nodeId: string;
  steps: Map<string, Step>;
  /** The last run's trigger body, or the canvas test payload. */
  triggerBody: unknown;
  environment: Environment;
  children: ReactNode;
}) {
  const [env, setEnv] = useState<{ environment: Environment; names: string[] } | null>(null);
  const target = useRef<Inserter | null>(null);
  const testUsers = useTestUsers(environment);

  useEffect(() => {
    let live = true;
    fetchVariables(environment)
      .then((r) => live && setEnv({ environment, names: [...r.data.map((v) => v.name), ...r.missing.map((m) => m.name)].sort() }))
      .catch(() => live && setEnv({ environment, names: [] }));
    return () => {
      live = false;
    };
  }, [environment]);

  const upstream = ancestors(workflow, nodeId);
  const webhook = workflow.nodes.find((n) => n.type === "webhook");
  const webhookStep = webhook && steps.get(webhook.id);
  const sources: DataSource[] = [
    {
      root: "trigger",
      label: "Webhook payload",
      type: "trigger",
      value: (webhookStep?.output as DataSource["value"]) ?? { body: triggerBody, headers: {} },
      ran: true,
    },
  ];
  // In run order, then this node last.
  const ordered = [...workflow.nodes.filter((n) => upstream.has(n.id) && n.type !== "webhook"), ...workflow.nodes.filter((n) => n.id === nodeId)];
  for (const node of ordered) {
    const step = steps.get(node.id);
    const ran = step?.output !== undefined;
    sources.push({
      root: node.id,
      label: node.id === nodeId ? `${node.name} (this node)` : node.name,
      type: node.type,
      value: ran ? step!.output : outputShape(node.type, node.config),
      ran,
    });
  }

  const value: TemplateData = {
    sources,
    env: env?.environment === environment ? env.names : [],
    user: testUsers?.columns.map((c) => c.name) ?? [],
    hasRun: steps.size > 0,
    setTarget: (insert) => {
      target.current = insert;
    },
    insert: (text) => {
      return target.current?.(text) ?? false;
    },
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
