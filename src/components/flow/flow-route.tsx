"use client";

import { useParams } from "next/navigation";
import { FlowWorkspace } from "./flow-workspace";

export function FlowRoute() {
  const { workflowId } = useParams<{ workflowId: string }>();
  // Keyed so switching workflows starts from a clean editor state.
  return <FlowWorkspace key={workflowId} workflowId={workflowId} />;
}
