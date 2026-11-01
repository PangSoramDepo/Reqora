import type { Metadata } from "next";
import { ExecutionsWorkspace } from "@/components/executions/executions-workspace";

export const metadata: Metadata = {
  title: "Execution History",
};

export default function ExecutionsPage() {
  return <ExecutionsWorkspace />;
}
