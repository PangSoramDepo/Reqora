import type { Metadata } from "next";
import { Suspense } from "react";
import { CollectionsWorkspace } from "@/components/collections/collections-workspace";

export const metadata: Metadata = {
  title: "Collections & Requests",
};

export default function CollectionsPage() {
  // The selected request lives in `?request=`, read on the client inside a Suspense boundary.
  return (
    <Suspense fallback={<div className="h-[calc(100vh-3.5rem-2.5rem)]" />}>
      <CollectionsWorkspace />
    </Suspense>
  );
}
