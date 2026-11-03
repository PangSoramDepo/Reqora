import type { Metadata } from "next";
import { Suspense } from "react";
import { FlowRoute } from "@/components/flow/flow-route";

export const metadata: Metadata = {
  title: "Flow Canvas",
};

export default function FlowPage() {
  // The workflow id is a runtime param, so the client reads it inside a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-[calc(100vh-3.5rem-2.5rem)]" />}>
      <FlowRoute />
    </Suspense>
  );
}
