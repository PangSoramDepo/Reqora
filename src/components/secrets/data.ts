/**
 * Mock data for the Environment Secrets screen.
 * All credential values are fake placeholders; this module will be replaced by a real API.
 */

export type EnvId = "prod" | "staging" | "sandbox";

export type Environment = {
  id: EnvId;
  label: string;
  region: string;
  /** Dot colour class. */
  dot: string;
  /** Text colour applied to the button when selected. */
  activeText: string;
};

export const ENVIRONMENTS: Environment[] = [
  { id: "prod", label: "Production", region: "US-East", dot: "bg-primary animate-pulse", activeText: "text-primary" },
  { id: "staging", label: "Staging", region: "EU-West", dot: "bg-tertiary", activeText: "text-tertiary" },
  { id: "sandbox", label: "Local Sandbox", region: "Docker", dot: "bg-secondary", activeText: "text-secondary" },
];

export type ConnectionAction = { title: string; icon: string; className?: string };

export type Connection = {
  id: string;
  name: string;
  subtitle: string;
  icon: string;
  /** Accent colour token, e.g. "primary" → bg-primary / text-primary. */
  accentBg: string;
  accentText: string;
  status: string;
  details: { label: string; value: string; className: string }[];
  footer: string;
  actions: ConnectionAction[];
};

export const CONNECTIONS: Connection[] = [
  {
    id: "stripe",
    name: "Stripe API",
    subtitle: "REST v2024-04",
    icon: "credit_card",
    accentBg: "bg-primary",
    accentText: "text-primary",
    status: "Connected",
    details: [
      { label: "Credential Mode", value: "Live Restricted Key", className: "text-on-surface font-label-md" },
      { label: "Bound Nodes", value: "3 Flow Canvas nodes", className: "text-primary font-medium" },
      { label: "Expiry", value: "Oct 2026", className: "text-on-surface" },
    ],
    footer: "rk_live_...97A2",
    actions: [
      { title: "Test Connection", icon: "electrical_services" },
      { title: "Rotate Key", icon: "cached" },
    ],
  },
  {
    id: "slack",
    name: "Slack Bot OAuth",
    subtitle: "Workspace App",
    icon: "tag",
    accentBg: "bg-tertiary",
    accentText: "text-tertiary",
    status: "Active Token",
    details: [
      { label: "OAuth Scopes", value: "4 Scopes Granted", className: "text-tertiary font-label-md" },
      { label: "Bound Nodes", value: "Alert Dispatches (2)", className: "text-on-surface font-medium" },
      { label: "Permissions", value: "chat:write, files", className: "text-on-surface truncate max-w-[120px]" },
    ],
    footer: "xoxb-891...33F1",
    actions: [
      { title: "Verify Token", icon: "verified_user" },
      { title: "Reauthorize OAuth", icon: "sync" },
    ],
  },
  {
    id: "twilio",
    name: "Twilio SMS",
    subtitle: "Auth Token + SID",
    icon: "sms",
    accentBg: "bg-secondary",
    accentText: "text-secondary",
    status: "Active",
    details: [
      { label: "Account SID", value: "AC8f...1b7e", className: "text-on-surface font-label-md" },
      { label: "Bound Nodes", value: "OTP Verification (1)", className: "text-on-surface font-medium" },
      { label: "Sender Pool", value: "+1 (855) 902-88", className: "text-on-surface" },
    ],
    footer: "Auth Token Vaulted",
    actions: [
      { title: "Ping Endpoint", icon: "network_ping" },
      { title: "Update Token", icon: "edit" },
    ],
  },
  {
    id: "erp",
    name: "ERP Gateway",
    subtitle: "mTLS Certificate",
    icon: "shield",
    accentBg: "bg-primary-container",
    accentText: "text-primary-container",
    status: "X.509 Loaded",
    details: [
      { label: "Cert Subject", value: "cn=flow-exec-01", className: "text-on-surface font-label-md" },
      { label: "Bound Nodes", value: "Ledger Sync (4)", className: "text-on-surface font-medium" },
      { label: "Cert Expiry", value: "23 days remaining", className: "text-tertiary" },
    ],
    footer: "SHA256 Fingerprint",
    actions: [
      { title: "Download Public Cert", icon: "download" },
      { title: "Renew Certificate", icon: "autorenew", className: "text-tertiary" },
    ],
  },
];

export type VariableAction = { title: string; icon: string; className: string };

export type Variable = {
  id: string;
  name: string;
  nameClassName: string;
  description: string;
  type: { label: string; icon?: string; className: string };
  value: string;
  /** Masked placeholder; omitted for non-sensitive values that are never masked. */
  masked?: string;
  /** Whether a maskable value starts out revealed. */
  initiallyRevealed?: boolean;
  valueClassName: string;
  valueNote?: string;
  scope: { label: string; className: string };
  usage: { count: string; label: string; className: string };
  modified: { when: string; by: string };
  actions: VariableAction[];
};

const EDIT: VariableAction = {
  title: "Edit Variable",
  icon: "edit",
  className: "text-on-surface-variant hover:text-on-surface",
};
const AUDIT: VariableAction = {
  title: "Audit Log",
  icon: "history",
  className: "text-on-surface-variant hover:text-on-surface",
};
const ROTATE = (title: string): VariableAction => ({
  title,
  icon: "cached",
  className: "text-tertiary hover:text-on-surface",
});

export const DELETE_ACTION: VariableAction = {
  title: "Delete",
  icon: "delete",
  className: "text-error hover:text-on-error-container",
};

const GLOBAL_SCOPE = { label: "Global", className: "text-primary" };

export const VARIABLES: Variable[] = [
  {
    id: "api-base-url",
    name: "API_BASE_URL",
    nameClassName: "text-primary",
    description: "Primary backend gateway root host",
    type: { label: "String", className: "text-secondary" },
    value: "https://api.internal.reqora.net/v2",
    masked: "••••••••••••••••••••••••••••••••••",
    initiallyRevealed: true,
    valueClassName: "text-on-surface truncate",
    scope: GLOBAL_SCOPE,
    usage: { count: "8", label: "Flow nodes", className: "bg-primary/20 text-primary" },
    modified: { when: "2 hours ago", by: "devops-bot" },
    actions: [EDIT, AUDIT],
  },
  {
    id: "stripe-webhook-secret",
    name: "STRIPE_WEBHOOK_SECRET",
    nameClassName: "text-tertiary",
    description: "Signature validation secret for invoice events",
    type: { label: "Secret", icon: "lock", className: "text-tertiary" },
    value: "whsec_FAKE0000example0000demo",
    masked: "••••••••••••••••••••••••••••••••••••",
    valueClassName: "text-on-surface truncate font-semibold",
    scope: { label: "Checkout Pipeline", className: "text-tertiary" },
    usage: { count: "2", label: "Webhook Nodes", className: "bg-tertiary/20 text-tertiary" },
    modified: { when: "Yesterday", by: "sarah.dev" },
    actions: [ROTATE("Rotate Secret"), EDIT],
  },
  {
    id: "max-retry-count",
    name: "MAX_RETRY_COUNT",
    nameClassName: "text-on-surface",
    description: "Exponential backoff threshold for async requests",
    type: { label: "Number", className: "text-primary-fixed" },
    value: "5",
    valueClassName: "text-primary font-bold",
    scope: GLOBAL_SCOPE,
    usage: { count: "12", label: "HTTP Blocks", className: "bg-surface-container-highest text-on-surface" },
    modified: { when: "3 days ago", by: "alex.arch" },
    actions: [EDIT, AUDIT],
  },
  {
    id: "encryption-key",
    name: "ENCRYPTION_KEY",
    nameClassName: "text-tertiary",
    description: "Envelope encryption master key (Customer payloads)",
    type: { label: "AES-256", icon: "key", className: "text-tertiary" },
    value: "0000fake0000demo0000not0000real0000",
    masked: "••••••••••••••••••••••••••••••••••••",
    valueClassName: "text-on-surface truncate font-semibold",
    scope: GLOBAL_SCOPE,
    usage: { count: "5", label: "Transform Nodes", className: "bg-tertiary/20 text-tertiary" },
    modified: { when: "May 14, 2024", by: "security-admin" },
    actions: [ROTATE("Rotate Key"), EDIT],
  },
  {
    id: "enable-debug-tracing",
    name: "ENABLE_DEBUG_TRACING",
    nameClassName: "text-on-surface",
    description: "Emit OpenTelemetry distributed spans to Jaeger",
    type: { label: "Boolean", className: "text-primary" },
    value: "false",
    valueClassName: "text-tertiary font-bold",
    valueNote: "(Disabled in Prod)",
    scope: GLOBAL_SCOPE,
    usage: { count: "All", label: "Pipeline Root", className: "bg-surface-container-highest text-on-surface" },
    modified: { when: "1 week ago", by: "devops-bot" },
    actions: [EDIT, AUDIT],
  },
];

export type BindingKind = { label: string; className: string; dot: string };

export const MATRIX_COLUMNS = ["API_BASE_URL", "STRIPE_SEC", "ENCRYPTION_KEY", "SLACK_TOKEN"] as const;

const PRIMARY_BINDING = { className: "bg-primary/20 text-primary", dot: "bg-primary" };
const TERTIARY_BINDING = { className: "bg-tertiary/20 text-tertiary", dot: "bg-tertiary" };

export type MatrixNode = {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  iconClassName: string;
  /** One entry per MATRIX_COLUMNS item; null = unused. */
  bindings: (BindingKind | null)[];
};

export const MATRIX_NODES: MatrixNode[] = [
  {
    id: "n01",
    title: "Node #01: Webhook Inbound",
    subtitle: "Customer Checkout Trigger",
    icon: "webhook",
    iconClassName: "text-tertiary",
    bindings: [null, { label: "Direct", ...TERTIARY_BINDING }, null, null],
  },
  {
    id: "n02",
    title: "Node #02: Fetch Cart Details",
    subtitle: "Backend REST Call",
    icon: "http",
    iconClassName: "text-primary",
    bindings: [{ label: "Direct", ...PRIMARY_BINDING }, null, null, null],
  },
  {
    id: "n03",
    title: "Node #03: Encrypt Card Token",
    subtitle: "PII Data Obfuscation",
    icon: "transform",
    iconClassName: "text-secondary",
    bindings: [null, null, { label: "Master", ...TERTIARY_BINDING }, null],
  },
  {
    id: "n04",
    title: "Node #04: Stripe Charge Dispatch",
    subtitle: "POST /v1/payment_intents",
    icon: "http",
    iconClassName: "text-primary",
    bindings: [null, { label: "Bearer", ...TERTIARY_BINDING }, null, null],
  },
  {
    id: "n05",
    title: "Node #05: Ops Alert Notification",
    subtitle: "Slack #alerts-finance channel",
    icon: "notifications_active",
    iconClassName: "text-outline",
    bindings: [null, null, null, { label: "Bot", ...PRIMARY_BINDING }],
  },
];

export type AuthPreset = { id: string; label: string; icon: string; iconClassName: string };

export const AUTH_PRESETS: AuthPreset[] = [
  { id: "oauth2", label: "OAuth 2.0", icon: "link", iconClassName: "text-primary" },
  { id: "bearer", label: "Bearer Token", icon: "token", iconClassName: "text-tertiary" },
  { id: "apikey", label: "API Key", icon: "key", iconClassName: "text-secondary" },
  { id: "basic", label: "Basic Auth", icon: "badge", iconClassName: "text-primary-fixed" },
  { id: "aws", label: "AWS IAM SigV4", icon: "cloud", iconClassName: "text-tertiary" },
  { id: "raw", label: "Raw Env Var", icon: "code", iconClassName: "text-outline" },
];

export const TARGET_ENV_OPTIONS = [
  { value: "prod", label: "Production (Current)" },
  { value: "staging", label: "Staging EU-West" },
  { value: "sandbox", label: "Local Sandbox" },
  { value: "all", label: "Synchronize All Environments" },
];

export const VISIBILITY_OPTIONS = [
  { value: "global", label: "Global (All Pipelines)" },
  { value: "checkout", label: "Customer Checkout Flow" },
  { value: "auth", label: "Auth & Session Pipelines" },
];
