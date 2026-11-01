import { Icon } from "@/components/icon";

const ICON_BUTTON =
  "p-space-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors rounded";

export function TopBar() {
  return (
    <header className="fixed top-0 left-64 right-0 h-14 bg-surface-container-low/90 backdrop-blur-xl z-40 px-space-md flex items-center justify-between shadow-[0_1px_8px_rgba(0,0,0,0.25)]">
      <div className="flex items-center gap-space-md">
        <div className="flex items-center gap-space-xs">
          <span className="h-8 w-8 rounded-xl bg-primary-container/20 flex items-center justify-center">
            <Icon name="hub" className="text-primary text-headline-md" />
          </span>
          <span className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">
            Reqora
          </span>
        </div>
        <div className="flex items-center gap-space-xs font-body-sm text-body-sm text-on-surface-variant">
          <span className="text-outline">/</span>
          <span>Workspaces</span>
          <span className="text-outline">/</span>
          <span>Payments &amp; Auth</span>
          <span className="text-outline">/</span>
          <span className="text-on-surface font-medium">Customer Checkout Pipeline</span>
        </div>
        <div className="flex items-center gap-space-xxs px-space-xs py-space-xxs rounded bg-surface-container-highest text-tertiary border border-outline-variant/30">
          <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
          <span className="font-label-sm text-label-sm uppercase">Production US-East</span>
        </div>
      </div>

      <div className="flex items-center gap-space-sm">
        <div className="flex items-center rounded bg-surface-container-highest p-space-xxs">
          <button className={ICON_BUTTON} title="Zoom Out" type="button">
            <Icon name="remove" className="text-body-md" />
          </button>
          <span className="px-space-xs font-label-sm text-label-sm text-on-surface">100%</span>
          <button className={ICON_BUTTON} title="Zoom In" type="button">
            <Icon name="add" className="text-body-md" />
          </button>
          <button className={`${ICON_BUTTON} ml-space-xxs`} title="Toggle Minimap" type="button">
            <Icon name="map" className="text-body-md" />
          </button>
        </div>
        <button
          className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-body-sm text-body-sm transition-colors"
          type="button"
        >
          <Icon name="share" className="text-body-md" />
          <span>Share</span>
        </button>
        <button
          className="flex items-center gap-space-xs px-space-sm py-space-xs rounded bg-secondary-container hover:bg-secondary-container/80 text-on-secondary-container font-body-sm text-body-sm transition-colors"
          type="button"
        >
          <Icon name="cloud_upload" className="text-body-md" />
          <span>Deploy</span>
        </button>
        <button
          className="flex items-center gap-space-xs px-space-md py-space-xs rounded bg-primary text-on-primary hover:bg-primary-container font-body-sm text-body-sm font-semibold transition-all"
          type="button"
        >
          <Icon name="play_arrow" className="text-body-md" />
          <span>Run Workflow</span>
          <span className="w-2 h-2 rounded-full bg-on-primary animate-ping" />
        </button>
        <div className="flex items-center gap-space-xs pl-space-xs">
          <span
            className="w-8 h-8 rounded-full bg-secondary-container text-on-secondary-container font-label-md text-label-md flex items-center justify-center"
            title="Profile"
          >
            PS
          </span>
        </div>
      </div>
    </header>
  );
}
