/**
 * Mock telemetry data for the Telemetry & Metrics screen.
 * Replace with real API data once the telemetry backend is wired up.
 */

export type Tone = "primary" | "secondary" | "tertiary" | "error";

/** Literal class names per tone so Tailwind can see them at build time. */
export const TONE_CLASSES: Record<Tone, { text: string; bg: string; soft: string; dot: string }> = {
  primary: { text: "text-primary", bg: "bg-primary", soft: "bg-primary/10", dot: "bg-primary" },
  secondary: { text: "text-secondary", bg: "bg-secondary", soft: "bg-secondary/10", dot: "bg-secondary" },
  tertiary: { text: "text-tertiary", bg: "bg-tertiary", soft: "bg-tertiary/10", dot: "bg-tertiary" },
  error: { text: "text-error", bg: "bg-error", soft: "bg-error/10", dot: "bg-error" },
};

export type ApiQuota = { name: string; percent: number; tone: Tone };

export const API_QUOTAS: ApiQuota[] = [
  { name: "Stripe API (Tier 2)", percent: 74, tone: "tertiary" },
  { name: "SAP NetWeaver ERP", percent: 45, tone: "primary" },
  { name: "Slack Webhook", percent: 12, tone: "secondary" },
];

export type ThroughputStat = { label: string; value: string; valueClass: string };

export const THROUGHPUT_STATS: ThroughputStat[] = [
  { label: "SUCCESS RATE", value: "99.88%", valueClass: "text-primary" },
  { label: "ERROR COUNT", value: "2,891", valueClass: "text-error" },
  { label: "PEAK REQ/SEC", value: "1,840 rps", valueClass: "text-on-surface" },
];

export const THROUGHPUT_AXIS = ["00:00 UTC", "04:00", "08:00", "12:00", "16:00", "20:00", "Now (Live)"];

export type RootCause = { label: string; percent: number; count: string; tone: Tone };

export const ROOT_CAUSES: RootCause[] = [
  { label: "HTTP 504 Gateway Timeout", percent: 54, count: "1,561", tone: "error" },
  { label: "HTTP 429 Rate Limited", percent: 31, count: "896", tone: "tertiary" },
  { label: "Schema Mismatch (JSON)", percent: 15, count: "434", tone: "secondary" },
];

export type PipelineNode = {
  index: string;
  name: string;
  latencyMs: number;
  share: number;
  /** Width of the heat bar, in percent. */
  heat: number;
  icon: string;
  tone: Tone;
  badgeTone: Tone;
  bottleneck?: boolean;
};

export const PIPELINE_NODES: PipelineNode[] = [
  { index: "01", name: "Stripe Webhook Ingress", latencyMs: 14, share: 3, heat: 14, icon: "sensors", tone: "primary", badgeTone: "primary" },
  { index: "02", name: "JWT Token Verify", latencyMs: 28, share: 6, heat: 28, icon: "lock", tone: "primary", badgeTone: "primary" },
  { index: "03", name: "JSON Payload Mapping", latencyMs: 19, share: 4, heat: 19, icon: "transform", tone: "secondary", badgeTone: "primary" },
  { index: "04", name: "SAP NetWeaver ERP Sync", latencyMs: 320, share: 65, heat: 85, icon: "warning", tone: "error", badgeTone: "error", bottleneck: true },
  { index: "05", name: "Client Response Emit", latencyMs: 109, share: 22, heat: 48, icon: "output_circle", tone: "tertiary", badgeTone: "tertiary" },
];

export type CircuitControl =
  | { kind: "closed" }
  | {
      kind: "toggle";
      initiallyTripped: boolean;
      /** Label/icon shown while the breaker is not tripped (before first interaction). */
      label: string;
      icon: string;
      iconClass: string;
      autoBypassNote?: string;
    };

export type RunAction = { kind: "retry"; label: string; icon: string } | { kind: "inspect" };

export type FlowRun = {
  id: string;
  ok: boolean;
  icon: string;
  iconClass?: string;
  timestamp: string;
  flow: string;
  duration: string;
  durationClass: string;
  status: string;
  statusClass: string;
  /** Either a failing node + message, or a plain success note. */
  failure?: { node: string; message: string; tone: Tone };
  note?: string;
  circuit: CircuitControl;
  action: RunAction;
};

export const FLOW_RUNS: FlowRun[] = [
  {
    id: "tr_9bf41a02",
    ok: false,
    icon: "sync_problem",
    timestamp: "Just now (12:44:02)",
    flow: "Checkout_Fulfillment_v4",
    duration: "1,240ms (exceeded)",
    durationClass: "text-error",
    status: "HTTP 504",
    statusClass: "bg-error/20 text-error",
    failure: { node: "Node_04_SAP_Sync:", message: "Upstream gateway connection dropped", tone: "error" },
    circuit: {
      kind: "toggle",
      initiallyTripped: true,
      label: "RESET",
      icon: "power_settings_new",
      iconClass: "text-primary",
      autoBypassNote: "Auto-bypass: OFF",
    },
    action: { kind: "retry", label: "Retry", icon: "replay" },
  },
  {
    id: "tr_c17e88ef",
    ok: true,
    icon: "check_circle",
    iconClass: "text-primary",
    timestamp: "12s ago",
    flow: "Checkout_Fulfillment_v4",
    duration: "284ms",
    durationClass: "text-on-surface",
    status: "200 OK",
    statusClass: "bg-primary/20 text-primary",
    note: "All 5 stages resolved seamlessly",
    circuit: { kind: "closed" },
    action: { kind: "inspect" },
  },
  {
    id: "tr_55a29d10",
    ok: false,
    icon: "warning",
    iconClass: "text-tertiary",
    timestamp: "28s ago",
    flow: "Stripe_Refund_Dispatcher",
    duration: "68ms",
    durationClass: "text-tertiary",
    status: "HTTP 429",
    statusClass: "bg-tertiary/20 text-tertiary",
    failure: { node: "Stripe_Card_Auth:", message: "Rate limit reached (100 req/s cap)", tone: "tertiary" },
    circuit: { kind: "toggle", initiallyTripped: false, label: "PAUSE NODE", icon: "toggle_on", iconClass: "text-tertiary" },
    action: { kind: "retry", label: "Backoff Retry", icon: "replay" },
  },
  {
    id: "tr_1900df83",
    ok: true,
    icon: "check_circle",
    iconClass: "text-primary",
    timestamp: "45s ago",
    flow: "User_Onboarding_Event",
    duration: "142ms",
    durationClass: "text-on-surface",
    status: "201 CREATED",
    statusClass: "bg-primary/20 text-primary",
    note: "Webhook payload dispatched to Slack #alerts",
    circuit: { kind: "closed" },
    action: { kind: "inspect" },
  },
  {
    id: "tr_aa409c11",
    ok: false,
    icon: "data_object",
    iconClass: "text-secondary",
    timestamp: "1m 12s ago",
    flow: "Checkout_Fulfillment_v4",
    duration: "41ms",
    durationClass: "text-secondary",
    status: "SCHEMA ERR",
    statusClass: "bg-secondary/20 text-secondary",
    failure: { node: "JSON_Transform:", message: "Missing expected field: `billing.tax_id`", tone: "secondary" },
    circuit: { kind: "toggle", initiallyTripped: false, label: "MOCK RESPONSE", icon: "tune", iconClass: "text-secondary" },
    action: { kind: "retry", label: "Fix & Replay", icon: "edit_note" },
  },
];

export const TOTAL_LOGGED_RUNS = "4,120";
