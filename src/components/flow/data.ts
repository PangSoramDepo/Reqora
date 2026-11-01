import type { FlowEdge, FlowNode } from "./graph";

// Mock "Customer Checkout Pipeline" graph — replace with the workflow API once it exists.
export const INITIAL_NODES: FlowNode[] = [
  { id: "node-1", kind: "webhook", x: 50, y: 130 },
  { id: "node-2", kind: "stripe-auth", x: 460, y: 100 },
  { id: "node-3", kind: "evaluate-tier", x: 890, y: 70 },
  { id: "node-4", kind: "erp-sync", x: 890, y: 270 },
  { id: "node-5", kind: "slack-dispatch", x: 1310, y: 150 },
];

export const EDGES: FlowEdge[] = [
  { id: "e1-2", from: "node-1", port: "order", to: "node-2", tone: "primary", dashed: true, animated: true },
  { id: "e2-3", from: "node-2", port: "verified", to: "node-3", tone: "secondary" },
  { id: "e2-4", from: "node-2", port: "customer", to: "node-4", tone: "primary" },
  { id: "e3-5", from: "node-3", port: "true", to: "node-5", tone: "tertiary", dashed: true },
];

export const REQUEST_HEADERS = [
  { name: "Authorization", value: "Bearer {{env.STRIPE_SECRET}}", tone: "text-tertiary" },
  { name: "Content-Type", value: "application/json", tone: "text-on-surface" },
  { name: "Stripe-Version", value: "2023-10-16", tone: "text-on-surface" },
];

export type ExecutionStep = {
  label: string;
  dot: string;
  text: string;
  message: string;
  messageTone?: string;
  status?: string;
  duration?: string;
  pending?: boolean;
};

export const EXECUTION_STEPS: ExecutionStep[] = [
  { label: "#1 WEBHOOK", dot: "bg-secondary", text: "text-secondary", message: "ord_9941a received", duration: "0ms" },
  {
    label: "#2 STRIPE",
    dot: "bg-primary",
    text: "text-primary",
    message: "POST /customers/verify",
    status: "200 OK",
    duration: "114ms",
  },
  {
    label: "#3 EVAL_TIER",
    dot: "bg-secondary-fixed",
    text: "text-secondary-fixed",
    message: "Condition TRUE (749.50 > 500)",
    messageTone: "text-tertiary",
    duration: "1ms",
  },
  {
    label: "#4 SAP_ERP",
    dot: "bg-primary-container",
    text: "text-primary-container",
    message: "POST /sync-inventory",
    status: "200 OK",
    duration: "88ms",
  },
  {
    label: "#5 SLACK_NOTIFY",
    dot: "bg-tertiary",
    text: "text-tertiary",
    message: "Dispatching message...",
    pending: true,
  },
];
