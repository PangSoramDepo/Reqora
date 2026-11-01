"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";

const RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

const BASE = "px-space-sm py-space-xs rounded font-label-md text-label-md transition-colors";
const ACTIVE = `${BASE} bg-surface-container-high text-primary flex items-center gap-space-xs`;
const IDLE = `${BASE} hover:bg-surface-container-high text-on-surface-variant`;
const TOOL_BUTTON =
  "p-space-xs rounded hover:bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors";

export function TimeRangePicker() {
  const [range, setRange] = useState<Range>("24h");

  return (
    <div className="flex items-center gap-space-xs flex-shrink-0 bg-surface-container-lowest p-space-xxs rounded-lg">
      {RANGES.map((r) => (
        <button
          key={r}
          aria-pressed={range === r}
          className={range === r ? ACTIVE : IDLE}
          onClick={() => setRange(r)}
          type="button"
        >
          {range === r && <Icon name="schedule" className="text-body-md" />}
          {r}
        </button>
      ))}
      <span className="w-px h-5 bg-surface-variant mx-space-xxs" />
      <button className={TOOL_BUTTON} title="Export Runs HAR / JSON" type="button">
        <Icon name="download" className="text-body-lg" />
      </button>
      <button className={TOOL_BUTTON} title="Telemetry Configuration" type="button">
        <Icon name="tune" className="text-body-lg" />
      </button>
    </div>
  );
}
