import type { WorkflowInput } from "./schema";

export const CHECKOUT_WORKFLOW_ID = "wf_checkout_pipeline";

/**
 * The "Customer Checkout Pipeline" from the design. Its HTTP nodes call the local demo upstreams under
 * /api/demo so it runs end to end without third-party credentials.
 */
export const SEED_WORKFLOWS: { id: string; input: WorkflowInput }[] = [
  {
    id: CHECKOUT_WORKFLOW_ID,
    input: {
      name: "Customer Checkout Pipeline",
      description: "Verifies the customer, syncs ERP inventory and alerts #sales for high-value orders.",
      nodes: [
        {
          id: "node-1",
          name: "Webhook Trigger",
          type: "webhook",
          position: { x: 50, y: 130 },
          config: { method: "POST", path: "/hooks/order-created" },
        },
        {
          id: "node-2",
          name: "Auth & Customer Verify",
          type: "http",
          position: { x: 460, y: 100 },
          config: {
            method: "POST",
            url: "/api/demo/stripe/customers/verify",
            headers: {
              Authorization: "Bearer {{env.STRIPE_SECRET}}",
              "Content-Type": "application/json",
              "Stripe-Version": "2023-10-16",
            },
            body: '{\n  "account_token": "{{node-1.body.id}}",\n  "expected_amount": {{node-1.body.amount}},\n  "risk_eval": true\n}',
            timeoutMs: 10_000,
          },
        },
        {
          id: "node-3",
          name: "Evaluate Tier",
          type: "condition",
          position: { x: 890, y: 70 },
          config: { left: "{{node-1.body.amount}}", operator: ">", right: "500" },
        },
        {
          id: "node-4",
          name: "ERP Inventory Sync",
          type: "http",
          position: { x: 890, y: 270 },
          config: {
            method: "POST",
            url: "/api/demo/erp/sync-inventory",
            headers: {},
            body: '{\n  "customer_id": "{{node-2.body.customer_id}}",\n  "sku": "{{node-1.body.sku}}",\n  "qty": 1\n}',
            timeoutMs: 10_000,
          },
        },
        {
          id: "node-5",
          name: "Dispatch VIP Slack",
          type: "http",
          position: { x: 1310, y: 150 },
          config: {
            method: "POST",
            url: "/api/demo/slack/messages",
            headers: {},
            body: '{\n  "channel": "#sales",\n  "text": "New High-Tier Order Alert! Customer {{node-1.body.id}} spent ${{node-1.body.amount}}. Fast-tracking dispatch."\n}',
            timeoutMs: 10_000,
          },
        },
      ],
      edges: [
        { id: "e1-2", source: "node-1", sourcePort: "out", target: "node-2" },
        { id: "e2-3", source: "node-2", sourcePort: "out", target: "node-3" },
        { id: "e2-4", source: "node-2", sourcePort: "out", target: "node-4" },
        { id: "e3-5", source: "node-3", sourcePort: "true", target: "node-5" },
      ],
    },
  },
];

export const SAMPLE_ORDER = { id: "ord_9941a", amount: 749.5, currency: "USD", sku: "SKU-CHK-204" };
