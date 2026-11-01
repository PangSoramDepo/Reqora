import type { Metadata } from "next";
import { Icon } from "@/components/icon";
import { METRICS } from "@/components/executions/data";
import { RunInspector } from "@/components/executions/run-inspector";
import { RunsPanel } from "@/components/executions/runs-panel";
import { TimeRangePicker } from "@/components/executions/time-range-picker";

export const metadata: Metadata = {
  title: "Execution History",
};

export default function ExecutionsPage() {
  return (
    <div className="flex flex-col w-full pb-16">
      {/* Top Stats Strip / Workflow Run Telemetry Overview */}
      <section className="w-full px-space-lg py-space-md bg-surface-container-low shadow-sm">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-space-md">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-space-sm flex-1">
            {METRICS.map((m) => (
              <div
                key={m.label}
                className="p-space-sm rounded-lg bg-surface-container flex items-center justify-between group hover:bg-surface-container-high transition-colors shadow-sm"
              >
                <div className="min-w-0">
                  <span className="block font-label-sm text-label-sm uppercase tracking-wider text-outline truncate">
                    {m.label}
                  </span>
                  <div className="flex items-baseline gap-space-xs mt-space-xxs">
                    <span className={`font-display-lg text-headline-lg font-bold ${m.valueClass}`}>{m.value}</span>
                    <span className={`font-label-sm text-label-sm ${m.noteClass}`}>
                      {m.noteIcon && <Icon name={m.noteIcon} className="text-[13px]" />}
                      {m.note}
                    </span>
                  </div>
                </div>
                <div
                  className={`w-9 h-9 rounded flex items-center justify-center flex-shrink-0 ${m.iconWrapClass}`}
                >
                  <Icon name={m.icon} className="text-headline-sm" />
                </div>
              </div>
            ))}
          </div>
          <TimeRangePicker />
        </div>
      </section>

      {/* Live Canvas Split Debugger Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-sm p-space-sm items-start">
        <RunsPanel />
        <RunInspector />
      </div>
    </div>
  );
}
