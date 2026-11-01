import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { NavLinks } from "./nav-links";

const CORE_BLOCKS = [
  { icon: "http", label: "Send HTTP", tag: "REST", tone: "text-primary" },
  { icon: "webhook", label: "Webhook Trigger", tag: "EVENT", tone: "text-tertiary" },
  { icon: "transform", label: "Data Mapping", tag: "TRANS", tone: "text-secondary" },
  { icon: "call_split", label: "Condition/Filter", tag: "FLOW", tone: "text-primary-fixed" },
  { icon: "hourglass_top", label: "Delay / Sleep", tag: "WAIT", tone: "text-outline" },
  { icon: "output_circle", label: "Response / Output", tag: "EXIT", tone: "text-primary-container" },
];

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-64 bg-surface-container-low/95 backdrop-blur-xl z-50 flex flex-col shadow-[0_1px_8px_rgba(0,0,0,0.3)]">
      <div className="h-14 px-space-md flex items-center justify-between bg-surface-container-lowest/60">
        <div className="flex items-center gap-space-xs">
          <Icon name="account_tree" className="text-primary text-headline-sm" />
          <span className="font-headline-sm text-headline-sm text-on-surface uppercase tracking-wider font-semibold">
            Node Library
          </span>
        </div>
        <button
          className="p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
          title="Collapse Library Rail"
          type="button"
        >
          <Icon name="first_page" className="text-body-lg" />
        </button>
      </div>

      <div className="p-space-sm">
        <label className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container-lowest text-on-surface-variant">
          <Icon name="search" className="text-body-md" />
          <input
            className="w-full bg-transparent font-body-sm text-body-sm text-on-surface placeholder:text-outline focus:outline-none"
            placeholder="Filter nodes..."
            type="search"
          />
        </label>
      </div>

      <div className="px-space-sm pt-space-xs pb-space-sm">
        <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider px-space-xs mb-space-xs">
          Core Blocks
        </div>
        <div className="space-y-space-xxs">
          {CORE_BLOCKS.map((block) => (
            <div
              key={block.label}
              className="flex items-center justify-between p-space-xs rounded bg-surface-container hover:bg-surface-container-high transition-colors cursor-grab"
            >
              <div className="flex items-center gap-space-xs">
                <Icon name={block.icon} className={`${block.tone} text-body-lg`} />
                <span className="font-body-sm text-body-sm text-on-surface">{block.label}</span>
              </div>
              <span
                className={`font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest ${block.tone}`}
              >
                {block.tag}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-auto p-space-sm bg-surface-container-lowest/50">
        <div className="font-label-sm text-label-sm text-outline uppercase tracking-wider mb-space-xs">
          Navigation
        </div>
        {/* usePathname suspends on routes with unresolved dynamic params under cacheComponents. */}
        <Suspense fallback={<div className="h-[120px]" />}>
          <NavLinks />
        </Suspense>
      </div>
    </aside>
  );
}
