// Mock execution-history data. Replace with the real executions API later.

export type Metric = {
  label: string;
  value: string;
  valueClass: string;
  note: string;
  noteClass: string;
  noteIcon?: string;
  icon: string;
  iconWrapClass: string;
};

export const METRICS: Metric[] = [
  {
    label: "Runs (Last 24h)",
    value: "14,290",
    valueClass: "text-on-surface",
    note: "+8.2%",
    noteClass: "text-primary flex items-center",
    noteIcon: "trending_up",
    icon: "cycle",
    iconWrapClass: "bg-primary/10 text-primary",
  },
  {
    label: "Success Rate",
    value: "99.4%",
    valueClass: "text-primary",
    note: "/ 0.6% flakiness",
    noteClass: "text-outline",
    icon: "verified",
    iconWrapClass: "bg-primary/10 text-primary",
  },
  {
    label: "Avg Latency",
    value: "240ms",
    valueClass: "text-secondary",
    note: "p95: 395ms",
    noteClass: "text-outline",
    icon: "speed",
    iconWrapClass: "bg-secondary-container/20 text-secondary",
  },
  {
    label: "Failed Runs",
    value: "12",
    valueClass: "text-error",
    note: "4 unresolved",
    noteClass: "text-error bg-error-container/40 px-space-xs py-space-xxs rounded",
    icon: "error_circle_rounded",
    iconWrapClass: "bg-error-container/20 text-error",
  },
];

export type RunStatus = "200" | "500" | "RUNNING" | "RETRIED";
export type RunTrigger = "Webhook" | "Scheduled Cron" | "Manual Test";

export type Run = {
  id: string;
  status: RunStatus;
  statusLabel: string;
  trigger: RunTrigger;
  ago: string;
  duration: string;
  steps: string;
  summary: string;
};

export const RUNS: Run[] = [
  {
    id: "#run_893fa02",
    status: "500",
    statusLabel: "500 FAIL",
    trigger: "Webhook",
    ago: "12s ago",
    duration: "384ms",
    steps: "4/5 broken",
    summary: "Inventory Sync timed out: upstream gateway 504",
  },
  {
    id: "#run_893fa01",
    status: "200",
    statusLabel: "200 OK",
    trigger: "Manual Test",
    ago: "2m ago",
    duration: "218ms",
    steps: "5/5 complete",
    summary: "Stripe Auth & Slack notification verified",
  },
  {
    id: "#run_893fa00",
    status: "RUNNING",
    statusLabel: "RUNNING",
    trigger: "Webhook",
    ago: "Just now",
    duration: "410ms...",
    steps: "3/5 executing",
    summary: "Order Condition matched: forwarding payload",
  },
  {
    id: "#run_893f9ef",
    status: "RETRIED",
    statusLabel: "RETRIED (2x)",
    trigger: "Scheduled Cron",
    ago: "14m ago",
    duration: "640ms",
    steps: "5/5 passed",
    summary: "Attempt 2 resolved with backoff delay",
  },
  {
    id: "#run_893f9ee",
    status: "200",
    statusLabel: "200 OK",
    trigger: "Webhook",
    ago: "21m ago",
    duration: "192ms",
    steps: "5/5 passed",
    summary: "Checkout payload settled successfully",
  },
];

export const STATUS_FILTERS: { value: RunStatus | "all"; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "200", label: "200 OK (Success)" },
  { value: "500", label: "500 Error (Failed)" },
  { value: "RUNNING", label: "Running" },
  { value: "RETRIED", label: "Retried" },
];

export const TRIGGER_FILTERS: { value: RunTrigger | "all"; label: string }[] = [
  { value: "all", label: "All Triggers" },
  { value: "Webhook", label: "Webhook" },
  { value: "Scheduled Cron", label: "Scheduled Cron" },
  { value: "Manual Test", label: "Manual Test" },
];

export type StepTone = "tertiary" | "primary" | "secondary" | "error" | "skipped";

export type TraceStep = {
  n: number;
  name: string;
  detail: string;
  result?: string;
  duration: string;
  tone: StepTone;
  /** Waterfall bar geometry, in % of total run time. */
  bar?: { width: string; offset: string };
};

export const TRACE_STEPS: TraceStep[] = [
  {
    n: 1,
    name: "Webhook Received",
    detail: "stripe.event: charge.created",
    result: "200 OK",
    duration: "14ms",
    tone: "tertiary",
    bar: { width: "8%", offset: "0%" },
  },
  {
    n: 2,
    name: "Stripe Customer Verify",
    detail: "GET /v1/customers/cus_98A",
    result: "200 OK",
    duration: "120ms",
    tone: "primary",
    bar: { width: "32%", offset: "8%" },
  },
  {
    n: 3,
    name: "Order Condition Evaluated",
    detail: "amount > $50.00 → TRUE",
    result: "MATCH",
    duration: "4ms",
    tone: "secondary",
    bar: { width: "4%", offset: "40%" },
  },
  {
    n: 4,
    name: "Inventory Sync",
    detail: "POST /warehouse/stock/reserve",
    result: "504 TIMEOUT",
    duration: "246ms",
    tone: "error",
    bar: { width: "56%", offset: "44%" },
  },
  {
    n: 5,
    name: "Slack Notification Sent",
    detail: "SKIPPED (Due to predecessor error)",
    duration: "0ms",
    tone: "skipped",
  },
];

/** A syntax-highlighted line: list of [text, className?] tokens. */
export type CodeToken = readonly [text: string, className?: string];
export type CodeLine = readonly CodeToken[];

const k = (t: string, c = "text-primary"): CodeToken => [`"${t}"`, c];
const s = (t: string, c = "text-tertiary"): CodeToken => [`"${t}"`, c];

export const INPUT_PAYLOAD: CodeLine[] = [
  [["{"]],
  [["  "], k("order_id"), [": "], s("ord_92019318"), [","]],
  [["  "], k("customer"), [": {"]],
  [["    "], k("id"), [": "], s("cus_98A33190"), [","]],
  [["    "], k("tier"), [": "], s("enterprise_plus")],
  [["  },"]],
  [["  "], k("items"), [": ["]],
  [["    {"]],
  [["      "], k("sku"), [": "], s("NEX-NODE-ACCEL"), [","]],
  [["      "], k("quantity"), [": "], ["2", "text-secondary"], [","]],
  [["      "], k("warehouse"), [": "], s("us-east-cluster-04")],
  [["    }"]],
  [["  ],"]],
  [["  "], k("idempotency_key"), [": "], s("ik_893fa02_sec")],
  [["}"]],
];

export const ERROR_PAYLOAD: CodeLine[] = [
  [["{"]],
  [["  "], k("error", "text-error"), [": {"]],
  [["    "], k("type", "text-error"), [": "], s("UpstreamConnectionTimeout", "text-error"), [","]],
  [["    "], k("code", "text-error"), [": "], s("GATEWAY_TIMEOUT", "text-error"), [","]],
  [
    ["    "],
    k("message", "text-error"),
    [": "],
    s(
      "Upstream inventory microservice (10.240.18.99:8080) failed to respond within 240ms timeout window.",
      "text-on-surface",
    ),
    [","],
  ],
  [["    "], k("retryable", "text-error"), [": "], ["true", "text-secondary"], [","]],
  [["    "], k("recommended_backoff_ms", "text-error"), [": "], ["500", "text-secondary"]],
  [["  }"]],
  [["}"]],
];

export type HeaderLine = { name?: string; value: string; nameClass?: string; valueClass?: string };

export const REQUEST_HEADERS: HeaderLine[] = [
  { name: "POST", nameClass: "text-primary", value: "/warehouse/stock/reserve HTTP/2" },
  { name: "Host:", value: "api.internal.inventory.cluster.local" },
  { name: "Authorization:", value: "Bearer ••••••••••[MASKED_ENV_VAR]" },
  { name: "Content-Type:", value: "application/json; charset=utf-8" },
  { name: "X-Reqora-Trace-ID:", value: "trace_770982c_run_893fa02" },
  { name: "X-Reqora-Span-ID:", value: "span_node_04_inventory" },
  { name: "User-Agent:", value: "Reqora-Worker-Pool/v4.1.9-rc" },
];

export const RESPONSE_HEADERS: HeaderLine[] = [
  { value: "HTTP/2 504 Gateway Timeout", valueClass: "text-error font-bold" },
  { name: "server:", value: "envoy-proxy/1.26.0" },
  { name: "date:", value: "Tue, 24 Oct 2024 12:48:19 GMT" },
  { name: "content-length:", value: "246" },
  { name: "x-envoy-upstream-service-time:", value: "246" },
];

export const CONSOLE_LOGS: { text: string; className: string }[] = [
  {
    text: "[12:48:19.402] [WORKER] Node 01 (Webhook): Received valid signature sha256=9f8a...",
    className: "text-outline",
  },
  {
    text: "[12:48:19.416] [WORKER] Node 02 (Stripe Customer): Cache miss. Querying API.",
    className: "text-primary",
  },
  {
    text: "[12:48:19.536] [WORKER] Node 02: 200 OK. Customer cus_98A loaded (tier=enterprise_plus).",
    className: "text-outline",
  },
  {
    text: "[12:48:19.540] [EVAL] Node 03 (Condition): Condition check: order.amount ($129.00) > $50.00 => TRUE.",
    className: "text-secondary",
  },
  {
    text: "[12:48:19.544] [WORKER] Node 04 (Inventory): Initiating POST to warehouse/stock/reserve.",
    className: "text-outline",
  },
  {
    text: "[12:48:19.780] [WARN] Node 04: Downstream worker socket unresponsive after 230ms...",
    className: "text-tertiary",
  },
  {
    text: "[12:48:19.790] [FATAL] Node 04: Envoy Gateway 504 timeout exceeded. Pipeline halted.",
    className: "text-error font-bold",
  },
];
