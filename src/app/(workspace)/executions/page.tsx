import type { Metadata } from "next";
import { Suspense } from "react";
import { ExecutionsWorkspace } from "@/components/executions/executions-workspace";

export const metadata: Metadata = {
  title: "Execution History",
};

export default function ExecutionsPage() {
  // `?run=` is read on the client inside a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-[calc(100vh-3.5rem-2.5rem)]" />}>
      <ExecutionsWorkspace />
    </Suspense>
  );
}
