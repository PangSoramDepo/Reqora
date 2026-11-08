"use client";

import { Icon } from "@/components/icon";
import { useWorkspaces } from "@/lib/workspaces/client";

/** Tells viewers that nothing they change in this workspace is saved (the server refuses their edits). */
export function ViewOnlyBanner() {
  const { current } = useWorkspaces();
  if (current?.role !== "viewer") return null;
  return (
    <div
      role="status"
      className="sticky top-14 z-30 px-gutter-canvas py-space-xs bg-tertiary-container/20 text-tertiary font-body-sm text-body-sm flex items-center gap-space-xs backdrop-blur"
      data-testid="view-only-banner"
    >
      <Icon name="visibility" className="text-body-md" />
      You have view-only access to “{current.name}”: you can look around, but changes, runs and sends aren&apos;t allowed. Ask an owner for
      the Editor role.
    </div>
  );
}
