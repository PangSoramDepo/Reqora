"use client";

import { Icon } from "@/components/icon";
import { RUN_WINDOWS, type RunWindow } from "@/lib/workflows/schema";

const BASE = "px-space-sm py-space-xs rounded font-label-md text-label-md transition-colors";
const ACTIVE = `${BASE} bg-surface-container-high text-primary flex items-center gap-space-xs`;
const IDLE = `${BASE} hover:bg-surface-container-high text-on-surface-variant`;
const TOOL_BUTTON =
  "p-space-xs rounded hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors";

type TimeRangePickerProps = {
  value: RunWindow;
  onChange: (value: RunWindow) => void;
  onExport: () => void;
};

export function TimeRangePicker({ value, onChange, onExport }: TimeRangePickerProps) {
  return (
    <div className="flex items-center gap-space-xs flex-shrink-0 bg-surface-container-lowest p-space-xxs rounded-lg">
      {(Object.keys(RUN_WINDOWS) as RunWindow[]).map((r) => (
        <button key={r} aria-pressed={value === r} className={value === r ? ACTIVE : IDLE} onClick={() => onChange(r)} type="button">
          {value === r && <Icon name="schedule" className="text-body-md" />}
          {r}
        </button>
      ))}
      <span className="w-px h-5 bg-surface-variant mx-space-xxs" />
      <button className={TOOL_BUTTON} title="Export listed runs as JSON" type="button" onClick={onExport}>
        <Icon name="download" className="text-body-lg" />
      </button>
    </div>
  );
}
