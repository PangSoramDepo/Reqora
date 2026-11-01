import type { Metadata } from "next";
import { Icon } from "@/components/icon";
import {
  API_QUOTAS,
  PIPELINE_NODES,
  ROOT_CAUSES,
  THROUGHPUT_AXIS,
  THROUGHPUT_STATS,
  TONE_CLASSES,
  type PipelineNode,
} from "@/components/telemetry/data";
import { LiveRunsTable } from "@/components/telemetry/live-runs-table";

export const metadata: Metadata = {
  title: "Telemetry & Metrics",
};

const DONUT_RADIUS = 15.91549430918954;

/** Root causes with their cumulative stroke offset around the donut. */
const DONUT_SEGMENTS = ROOT_CAUSES.map((cause, i) => ({
  ...cause,
  offset: ROOT_CAUSES.slice(0, i).reduce((sum, c) => sum + c.percent, 0),
}));

export default function TelemetryPage() {
  return (
    <div className="flex flex-col w-full pb-14">
      {/* Top KPI & Metrics Bar */}
      <div className="px-space-lg pt-space-lg grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
        {/* KPI 1: Invocations */}
        <div className="p-space-md bg-surface-container-low rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="absolute -right-6 -bottom-6 w-24 h-24 bg-primary/10 rounded-full blur-xl pointer-events-none" />
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">Total Invocations</span>
            <span className="flex items-center gap-space-xxs text-primary font-label-sm text-label-sm bg-primary/10 px-space-xs py-space-xxs rounded">
              <Icon name="trending_up" className="text-body-sm" />
              +18.4%
            </span>
          </div>
          <div className="mt-space-sm flex items-baseline gap-space-xs">
            <span className="font-display-lg text-display-lg text-on-surface tracking-tight">
              2.42<span className="text-primary font-headline-md text-headline-md">M</span>
            </span>
            <span className="font-body-sm text-body-sm text-outline">/ 30 days</span>
          </div>
          <div className="mt-space-sm flex items-center justify-between text-outline font-label-sm text-label-sm">
            <span>Target: 3.0M cap</span>
            <span className="text-on-surface">80.6% used</span>
          </div>
          <div className="w-full bg-surface-container-highest h-1 rounded-full mt-space-xs overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: "80.6%" }} />
          </div>
        </div>

        {/* KPI 2: Error Spike Alert Banner */}
        <div className="p-space-md bg-surface-container-low rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">System Incidents</span>
            <span className="flex items-center gap-space-xxs font-label-sm text-label-sm text-primary px-space-xs py-space-xxs bg-primary/10 rounded">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Nominal
            </span>
          </div>
          <div className="mt-space-sm flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-lg bg-surface-container-highest flex items-center justify-center text-primary">
              <Icon name="verified_user" className="text-headline-md" />
            </div>
            <div>
              <div className="font-display-lg text-display-lg text-on-surface leading-none">0</div>
              <div className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">Active Spike Alerts</div>
            </div>
          </div>
          <div className="mt-space-sm flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant bg-surface-container p-space-xs rounded">
            <span>Last tripped: 4d 18h ago</span>
            <span className="text-outline">Resolved</span>
          </div>
        </div>

        {/* KPI 3: P95 Latency Gauge */}
        <div className="p-space-md bg-surface-container-low rounded-xl shadow-md relative overflow-hidden flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">P95 Pipeline Latency</span>
            <span className="flex items-center gap-space-xxs text-tertiary font-label-sm text-label-sm bg-tertiary/10 px-space-xs py-space-xxs rounded">
              <Icon name="speed" className="text-body-sm" />
              {"SLA < 500ms"}
            </span>
          </div>
          <div className="mt-space-xs flex items-center justify-between">
            <div>
              <div className="font-display-lg text-display-lg text-on-surface">
                320<span className="text-tertiary font-headline-md text-headline-md">ms</span>
              </div>
              <div className="font-body-sm text-body-sm text-outline mt-space-xxs">Avg: 142ms | P99: 610ms</div>
            </div>
            {/* Inline Radial SVG */}
            <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36" aria-hidden="true">
              <path
                className="text-surface-container-highest stroke-current"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                strokeWidth="3"
              />
              <path
                className="text-tertiary stroke-current"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                strokeDasharray="64, 100"
                strokeLinecap="round"
                strokeWidth="3.2"
              />
            </svg>
          </div>
          <div className="w-full bg-surface-container-highest h-1 rounded-full mt-space-xs overflow-hidden">
            <div className="bg-tertiary h-full rounded-full" style={{ width: "64%" }} />
          </div>
        </div>

        {/* KPI 4: 3rd-Party Rate Limits */}
        <div className="p-space-md bg-surface-container-low rounded-xl shadow-md flex flex-col justify-between">
          <div className="flex items-center justify-between mb-space-xs">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">3rd-Party API Quotas</span>
            <span className="font-label-sm text-label-sm text-error bg-error/10 px-space-xs py-space-xxs rounded">1 High</span>
          </div>
          <div className="space-y-space-xs">
            {API_QUOTAS.map((quota) => {
              const tone = TONE_CLASSES[quota.tone];
              return (
                <div key={quota.name}>
                  <div className="flex justify-between font-label-sm text-label-sm mb-space-xxs">
                    <span className="text-on-surface flex items-center gap-space-xxs">
                      <span className={`w-1.5 h-1.5 rounded-full ${tone.dot}`} />
                      {quota.name}
                    </span>
                    <span className={`${tone.text} font-body-sm text-body-sm font-semibold`}>{quota.percent}%</span>
                  </div>
                  <div className="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">
                    <div className={`${tone.bg} h-full rounded-full`} style={{ width: `${quota.percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Telemetry Charts Bento Section */}
      <div className="px-space-lg pt-space-md grid grid-cols-1 lg:grid-cols-12 gap-space-md">
        {/* Time-Series Volume & Error Breakdown (8 Cols) */}
        <div className="lg:col-span-8 bg-surface-container-low rounded-xl p-space-md shadow-md flex flex-col justify-between">
          <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-md">
            <div>
              <div className="flex items-center gap-space-xs">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Execution Throughput &amp; Error Spectrum
                </span>
                <span className="font-label-sm text-label-sm text-outline px-space-xs py-space-xxs rounded bg-surface-container-high">
                  Live 24h
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
                Real-time aggregate ingress calls vs non-2xx failure bursts across distributed gateways
              </p>
            </div>
            <div className="flex items-center gap-space-sm">
              <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                <span className="w-2.5 h-2.5 rounded bg-primary" />
                <span>Successful (2xx)</span>
              </div>
              <div className="flex items-center gap-space-xs font-label-sm text-label-sm text-on-surface-variant">
                <span className="w-2.5 h-2.5 rounded bg-error" />
                <span>Errors (4xx/5xx)</span>
              </div>
              <button
                type="button"
                className="px-space-xs py-space-xxs bg-surface-container-highest text-on-surface rounded hover:bg-surface-bright transition-colors font-label-sm text-label-sm"
              >
                Inspect Raw
              </button>
            </div>
          </div>
          {/* High Precision SVG Chart Area */}
          <div className="relative w-full h-56 pt-space-xs">
            <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 160" aria-hidden="true">
              <defs>
                <linearGradient id="primaryAreaGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#4cd7f6" stopOpacity="0.32" />
                  <stop offset="100%" stopColor="#4cd7f6" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="errorAreaGrad" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#ffb4ab" stopOpacity="0.45" />
                  <stop offset="100%" stopColor="#ffb4ab" stopOpacity="0.0" />
                </linearGradient>
              </defs>
              {/* Subtle Grid Lines */}
              {[30, 75, 120].map((y) => (
                <line key={y} stroke="#1b2b3f" strokeDasharray="3,3" strokeWidth="1" x1="0" x2="600" y1={y} y2={y} />
              ))}
              {/* Normal Invocations Area Path */}
              <path
                d="M 0,140 Q 40,90 90,110 T 180,60 T 270,85 T 360,40 T 450,75 T 530,30 T 600,65 L 600,160 L 0,160 Z"
                fill="url(#primaryAreaGrad)"
              />
              <path
                d="M 0,140 Q 40,90 90,110 T 180,60 T 270,85 T 360,40 T 450,75 T 530,30 T 600,65"
                fill="none"
                stroke="#4cd7f6"
                strokeLinecap="round"
                strokeWidth="2.5"
              />
              {/* Error Volume Peaks Area Path */}
              <path
                d="M 0,158 Q 50,158 90,155 T 180,150 T 270,132 T 360,154 T 450,145 T 530,122 T 600,155 L 600,160 L 0,160 Z"
                fill="url(#errorAreaGrad)"
              />
              <path
                d="M 0,158 Q 50,158 90,155 T 180,150 T 270,132 T 360,154 T 450,145 T 530,122 T 600,155"
                fill="none"
                stroke="#ffb4ab"
                strokeWidth="1.8"
              />
              {/* Bottleneck Spike Annotation Marker */}
              <circle className="fill-error animate-ping" cx="530" cy="122" r="3.5" />
              <circle className="fill-error" cx="530" cy="122" r="3.5" />
              <text fill="#ffb4ab" fontFamily="JetBrains Mono" fontSize="9" x="495" y="112">
                ERP Timeout (2.4%)
              </text>
            </svg>
            <div className="flex justify-between font-label-sm text-label-sm text-outline mt-space-xs">
              {THROUGHPUT_AXIS.map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
            </div>
          </div>
          {/* Quick Sub-metric Footnotes */}
          <div className="grid grid-cols-3 gap-space-sm pt-space-sm mt-space-sm bg-surface-container-lowest/60 rounded p-space-xs">
            {THROUGHPUT_STATS.map((stat) => (
              <div key={stat.label} className="flex flex-col">
                <span className="font-label-sm text-label-sm text-outline">{stat.label}</span>
                <span className={`font-headline-sm text-headline-sm ${stat.valueClass} font-bold`}>{stat.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Node Failure Breakdown Chart (4 Cols) */}
        <div className="lg:col-span-4 bg-surface-container-low rounded-xl p-space-md shadow-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">Error Root Cause</span>
              <Icon name="pie_chart" className="text-outline text-body-md" />
            </div>
            <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
              Failures by protocol &amp; validation status
            </p>
          </div>
          <div className="my-space-md flex flex-col items-center">
            {/* Donut Visual Breakdown */}
            <div className="relative w-36 h-36 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 42 42" aria-hidden="true">
                <circle
                  className="text-surface-container-highest stroke-current"
                  cx="21"
                  cy="21"
                  fill="none"
                  r={DONUT_RADIUS}
                  strokeWidth="4.5"
                />
                {DONUT_SEGMENTS.map((cause) => (
                  <circle
                    key={cause.label}
                    className={`${TONE_CLASSES[cause.tone].text} stroke-current`}
                    cx="21"
                    cy="21"
                    fill="none"
                    r={DONUT_RADIUS}
                    strokeDasharray={`${cause.percent} ${100 - cause.percent}`}
                    strokeDashoffset={-cause.offset}
                    strokeWidth="5"
                  />
                ))}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <span className="font-headline-md text-headline-md text-on-surface font-bold leading-none">2.8k</span>
                <span className="font-label-sm text-label-sm text-outline mt-space-xxs">FAILS</span>
              </div>
            </div>
          </div>
          {/* Causes Legend & Proportions */}
          <div className="space-y-space-xs">
            {ROOT_CAUSES.map((cause) => {
              const tone = TONE_CLASSES[cause.tone];
              return (
                <div key={cause.label} className="flex items-center justify-between p-space-xs rounded bg-surface-container-high/60">
                  <div className="flex items-center gap-space-xs">
                    <span className={`w-2 h-2 rounded ${tone.bg}`} />
                    <span className="font-label-sm text-label-sm text-on-surface">{cause.label}</span>
                  </div>
                  <span className={`font-body-sm text-body-sm ${tone.text} font-semibold`}>
                    {cause.percent}% ({cause.count})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Heatmap & Pipeline Latency Bottleneck Section */}
      <div className="px-space-lg pt-space-md">
        <div className="bg-surface-container-low rounded-xl p-space-md shadow-md">
          <div className="flex flex-wrap items-center justify-between gap-space-sm mb-space-md">
            <div>
              <div className="flex items-center gap-space-xs">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Per-Node Latency Heatmap &amp; Pipeline Chain
                </span>
                <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-tertiary/10 text-tertiary uppercase font-bold">
                  Bottleneck Identified
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant mt-space-xxs">
                Node contribution to end-to-end flow execution time (Avg total run duration: 492ms)
              </p>
            </div>
            <div className="flex items-center gap-space-xs">
              <span className="font-label-sm text-label-sm text-outline">HEAT INTENSITY:</span>
              <span className="px-space-xs py-space-xxs rounded bg-primary/20 text-primary font-label-sm text-label-sm">{"<50ms"}</span>
              <span className="px-space-xs py-space-xxs rounded bg-tertiary/30 text-tertiary font-label-sm text-label-sm">50-150ms</span>
              <span className="px-space-xs py-space-xxs rounded bg-error/30 text-error font-label-sm text-label-sm">{">200ms (Crit)"}</span>
            </div>
          </div>
          {/* Flow Nodes Step Distribution Timeline */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-space-sm">
            {PIPELINE_NODES.map((node) =>
              node.bottleneck ? <BottleneckNodeCard key={node.index} node={node} /> : <NodeCard key={node.index} node={node} />,
            )}
          </div>
        </div>
      </div>

      {/* Real-Time Active Runs Live Stream Table */}
      <div className="px-space-lg pt-space-md mb-space-md">
        <LiveRunsTable />
      </div>
    </div>
  );
}

function NodeCard({ node }: { node: PipelineNode }) {
  const tone = TONE_CLASSES[node.tone];
  const badge = TONE_CLASSES[node.badgeTone];
  return (
    <div className="p-space-sm bg-surface-container rounded-lg relative overflow-hidden flex flex-col justify-between">
      <div className="flex items-center justify-between mb-space-xs">
        <span className="font-label-sm text-label-sm text-outline uppercase font-semibold">Node {node.index}</span>
        <span className={`font-label-sm text-label-sm ${badge.text} ${badge.soft} px-space-xxs rounded`}>
          {node.share}% of run
        </span>
      </div>
      <div className="font-headline-sm text-headline-sm text-on-surface font-medium truncate">{node.name}</div>
      <div className="mt-space-sm flex items-baseline justify-between">
        <span className="font-display-lg text-display-lg text-on-surface leading-none">
          {node.latencyMs}
          <span className="text-body-sm font-normal text-outline">ms</span>
        </span>
        <Icon name={node.icon} className={`${tone.text} text-body-lg`} />
      </div>
      <div className="w-full bg-surface-container-highest h-1.5 rounded-full mt-space-sm overflow-hidden">
        <div className={`${tone.bg} h-full rounded-full`} style={{ width: `${node.heat}%` }} />
      </div>
    </div>
  );
}

function BottleneckNodeCard({ node }: { node: PipelineNode }) {
  return (
    <div className="p-space-sm bg-surface-container-high rounded-lg relative overflow-hidden flex flex-col justify-between shadow-lg">
      <div className="absolute inset-x-0 top-0 h-1 bg-error" />
      <div className="flex items-center justify-between mb-space-xs">
        <span className="font-label-sm text-label-sm text-error uppercase font-bold tracking-wider">
          Node {node.index} [BOTTLENECK]
        </span>
        <span className="font-label-sm text-label-sm text-on-error bg-error px-space-xs rounded font-bold">
          {node.share}% of run
        </span>
      </div>
      <div className="font-headline-sm text-headline-sm text-on-surface font-semibold truncate">{node.name}</div>
      <div className="mt-space-sm flex items-baseline justify-between">
        <span className="font-display-lg text-display-lg text-error font-bold leading-none">
          {node.latencyMs}
          <span className="text-body-sm font-normal text-outline">ms</span>
        </span>
        <Icon name={node.icon} className="text-error text-body-lg animate-pulse" />
      </div>
      <div className="w-full bg-surface-container-highest h-2 rounded-full mt-space-sm overflow-hidden">
        <div className="bg-error h-full rounded-full" style={{ width: `${node.heat}%` }} />
      </div>
    </div>
  );
}
