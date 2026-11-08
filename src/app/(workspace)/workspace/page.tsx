import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/workspaces/workspace-settings";

export const metadata: Metadata = {
  title: "Members & Settings",
};

export default function WorkspacePage() {
  return <WorkspaceSettings />;
}
