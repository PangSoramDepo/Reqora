import type { Metadata } from "next";
import { FlowWorkspace } from "@/components/flow/flow-workspace";

export const metadata: Metadata = {
  title: "Flow Canvas",
};

export default function FlowPage() {
  return <FlowWorkspace />;
}
