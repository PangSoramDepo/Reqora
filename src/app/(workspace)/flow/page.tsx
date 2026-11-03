import type { Metadata } from "next";
import { FlowIndex } from "@/components/flow/flow-index";

export const metadata: Metadata = {
  title: "Flow Canvas",
};

export default function FlowIndexPage() {
  return <FlowIndex />;
}
