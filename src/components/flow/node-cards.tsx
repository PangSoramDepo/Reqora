import type { ReactNode } from "react";
import { Icon } from "@/components/icon";
import type { NodeKind } from "./graph";

type PortProps = {
  name: string;
  color: string;
  className: string;
  title?: string;
};

/** Connection terminal; `data-port` lets the canvas measure where to attach edges. */
function Port({ name, color, className, title }: PortProps) {
  return (
    <div
      data-port={name}
      className={`w-3.5 h-3.5 rounded-full ${color} shadow-md absolute flex items-center justify-center cursor-pointer hover:scale-125 transition-transform ${className}`}
      title={title}
    >
      <div className="w-1.5 h-1.5 rounded-full bg-surface-container-lowest" />
    </div>
  );
}

const HEADER = "p-space-sm flex items-center justify-between bg-surface-container-lowest/40";
const TITLE = "font-headline-sm text-headline-sm text-on-surface";
const FOOTER = "px-space-sm py-space-xs bg-surface-container-lowest/30 rounded-b-xl relative";

function WebhookNode() {
  return (
    <>
      <div className="h-1 bg-secondary rounded-t-xl w-full" />
      <div className={HEADER}>
        <div className="flex items-center gap-space-xs">
          <Icon name="webhook" className="text-secondary text-headline-sm" />
          <span className={TITLE}>Webhook Trigger</span>
        </div>
        <div className="flex items-center gap-space-xxs">
          <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
          <span className="font-label-sm text-label-sm text-secondary uppercase">Active</span>
        </div>
      </div>
      <div className="p-space-sm flex flex-col gap-space-xs text-on-surface-variant font-body-sm text-body-sm">
        <div className="flex items-center justify-between">
          <span className="px-space-xs py-space-xxs rounded bg-secondary-container text-on-secondary-container font-label-sm text-label-sm font-semibold">
            POST
          </span>
          <span className="font-mono text-outline">/hooks/order-created</span>
        </div>
        <div className="p-space-xs rounded bg-surface-container-lowest font-mono text-[10px] leading-tight text-on-surface/80 flex flex-col gap-0.5 overflow-hidden">
          <div className="text-outline">{"// Event Preview (200 OK)"}</div>
          <div>
            {"{ "}
            <span className="text-primary">&quot;id&quot;</span>: <span className="text-tertiary">&quot;ord_9941a&quot;</span>,
          </div>
          <div className="pl-2">
            <span className="text-primary">&quot;amount&quot;</span>: <span className="text-tertiary">749.50</span>,
          </div>
          <div className="pl-2">
            <span className="text-primary">&quot;currency&quot;</span>: <span className="text-on-surface">&quot;USD&quot;</span>
            {" }"}
          </div>
        </div>
      </div>
      <div className={`${FOOTER} flex items-center justify-end`}>
        <span className="font-label-sm text-label-sm text-on-surface-variant mr-3">payload.order</span>
        <Port name="order" color="bg-secondary" className="-right-2" title="Output: order payload" />
      </div>
    </>
  );
}

function StripeAuthNode() {
  return (
    <>
      <div className="h-1.5 bg-primary rounded-t-xl w-full" />
      <Port name="in" color="bg-primary" className="-left-2 top-[102px] z-30" title="Input Port" />
      <div className="p-space-sm flex items-center justify-between bg-surface-container-highest/60">
        <div className="flex items-center gap-space-xs">
          <Icon name="verified_user" className="text-primary text-headline-sm" />
          <span className={TITLE}>Auth &amp; Customer Verify</span>
        </div>
        <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-primary/20 text-primary font-semibold">
          ACTIVE
        </span>
      </div>
      <div className="p-space-sm flex flex-col gap-space-xs font-body-sm text-body-sm">
        <div className="flex items-center gap-space-xs">
          <span className="px-space-xs py-space-xxs rounded bg-primary text-on-primary font-label-sm text-label-sm font-bold">
            POST
          </span>
          <span className="font-mono text-outline truncate text-body-sm">https://api.stripe.com/v1/cust...</span>
        </div>
        <div className="flex items-center justify-between px-space-xs py-space-xxs rounded bg-surface-container-lowest font-label-sm text-label-sm">
          <span className="text-outline">Bearer Token</span>
          <span className="text-tertiary font-mono">sk_live_...93b1</span>
        </div>
        <div className="flex items-center justify-between px-space-xs py-space-xxs rounded bg-surface-container-lowest">
          <div className="flex items-center gap-space-xxs">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span className="font-label-sm text-label-sm text-on-surface font-semibold">200 OK</span>
          </div>
          <span className="font-mono text-outline text-body-sm">114ms</span>
        </div>
      </div>
      <div className={`${FOOTER} flex flex-col gap-1 bg-surface-container-lowest/40 font-label-sm text-label-sm`}>
        <div className="flex items-center justify-between relative py-0.5">
          <span className="text-outline text-[10px]">res.verified</span>
          <span className="text-on-surface-variant">cust_status</span>
          <Port name="verified" color="bg-secondary" className="-right-5" title="Output: Verification Result" />
        </div>
        <div className="flex items-center justify-between relative py-0.5">
          <span className="text-outline text-[10px]">res.customer</span>
          <span className="text-primary font-medium">customer.id</span>
          <Port name="customer" color="bg-primary" className="-right-5" title="Output: Customer ID" />
        </div>
      </div>
    </>
  );
}

function EvaluateTierNode() {
  return (
    <>
      <div className="h-1 bg-secondary-fixed-dim rounded-t-xl w-full" />
      <Port name="in" color="bg-secondary-fixed-dim" className="-left-2 top-[65px]" />
      <div className={HEADER}>
        <div className="flex items-center gap-space-xs">
          <Icon name="call_split" className="text-secondary-fixed-dim text-headline-sm" />
          <span className={TITLE}>Evaluate Tier</span>
        </div>
        <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest text-secondary-fixed-dim font-mono">
          EXPR
        </span>
      </div>
      <div className="p-space-sm flex flex-col gap-space-xs font-body-sm text-body-sm">
        <div className="px-space-xs py-space-xxs rounded bg-surface-container-lowest font-mono text-on-surface">
          <span className="text-primary">order.total</span> <span className="text-tertiary font-bold">&gt;</span>{" "}
          <span className="text-secondary-fixed">500</span>
        </div>
        <div className="text-[10px] text-outline">Evaluates to Boolean state</div>
      </div>
      <div className={`${FOOTER} flex flex-col gap-1.5`}>
        <div className="flex items-center justify-between relative">
          <span className="font-label-sm text-label-sm text-tertiary font-bold">TRUE (VIP Priority)</span>
          <Port name="true" color="bg-tertiary" className="-right-5" />
        </div>
        <div className="flex items-center justify-between relative">
          <span className="font-label-sm text-label-sm text-outline">FALSE (Standard Queue)</span>
          <Port name="false" color="bg-outline" className="-right-5" />
        </div>
      </div>
    </>
  );
}

function ErpSyncNode() {
  return (
    <>
      <div className="h-1 bg-primary-container rounded-t-xl w-full" />
      <Port name="in" color="bg-primary" className="-left-2 top-[60px]" />
      <div className={HEADER}>
        <div className="flex items-center gap-space-xs">
          <Icon name="cloud_sync" className="text-primary-container text-headline-sm" />
          <span className={TITLE}>ERP Inventory Sync</span>
        </div>
        <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest text-primary-container">
          SAP v2
        </span>
      </div>
      <div className="p-space-sm flex flex-col gap-space-xs font-body-sm text-body-sm">
        <div className="flex items-center gap-space-xs">
          <span className="px-space-xs py-space-xxs rounded bg-primary text-on-primary font-label-sm text-label-sm font-bold">
            POST
          </span>
          <span className="font-mono text-outline truncate text-body-sm">/sync-inventory</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-1">
          <span className="px-space-xs py-0.5 rounded bg-surface-container-lowest text-tertiary font-mono text-[10px]">
            {"{{customer.id}}"}
          </span>
          <span className="px-space-xs py-0.5 rounded bg-surface-container-lowest text-primary font-mono text-[10px]">
            {"{{order.sku}}"}
          </span>
          <span className="px-space-xs py-0.5 rounded bg-surface-container-lowest text-secondary font-mono text-[10px]">
            qty: 1
          </span>
        </div>
      </div>
      <div className={`${FOOTER} flex items-center justify-end`}>
        <span className="font-label-sm text-label-sm text-on-surface-variant mr-3">erp.sync_ack</span>
        <Port name="ack" color="bg-primary-container" className="-right-2" />
      </div>
    </>
  );
}

function SlackDispatchNode() {
  return (
    <>
      <div className="h-1 bg-tertiary rounded-t-xl w-full" />
      <Port name="in" color="bg-tertiary" className="-left-2 top-[60px]" />
      <div className={HEADER}>
        <div className="flex items-center gap-space-xs">
          <Icon name="notifications_active" className="text-tertiary text-headline-sm" />
          <span className={TITLE}>Dispatch VIP Slack</span>
        </div>
        <span className="font-label-sm text-label-sm px-space-xs py-space-xxs rounded bg-surface-container-highest text-tertiary font-mono">
          #sales
        </span>
      </div>
      <div className="p-space-sm flex flex-col gap-space-xs font-body-sm text-body-sm">
        <div className="p-space-xs rounded bg-surface-container-lowest flex flex-col gap-1">
          <div className="flex items-center gap-space-xxs text-tertiary font-label-sm text-label-sm">
            <Icon name="star" className="text-body-sm" />
            <span className="font-semibold">New High-Tier Order Alert!</span>
          </div>
          <p className="font-body-sm text-[11px] text-on-surface/90">
            Customer <span className="text-primary font-mono font-medium">ord_9941a</span> spent{" "}
            <span className="text-tertiary font-bold">$749.50</span>. Fast-tracking dispatch.
          </p>
        </div>
      </div>
      <div className="px-space-sm py-space-xs flex items-center justify-between bg-surface-container-lowest/30 rounded-b-xl">
        <span className="font-label-sm text-label-sm text-outline">Terminal Exit</span>
        <span className="font-label-sm text-label-sm text-primary font-mono">201 Created</span>
      </div>
    </>
  );
}

export function NodeBody({ kind }: { kind: NodeKind }): ReactNode {
  switch (kind) {
    case "webhook":
      return <WebhookNode />;
    case "stripe-auth":
      return <StripeAuthNode />;
    case "evaluate-tier":
      return <EvaluateTierNode />;
    case "erp-sync":
      return <ErpSyncNode />;
    case "slack-dispatch":
      return <SlackDispatchNode />;
  }
}

/** Card chrome per node; the Stripe node is the one shown selected in the design. */
export const NODE_CARD_CLASS: Record<NodeKind, string> = {
  webhook: "bg-surface-container-high/90 shadow-xl hover:-translate-y-0.5",
  "stripe-auth": "bg-surface-container-high/95 shadow-2xl shadow-primary/20",
  "evaluate-tier": "bg-surface-container-high/90 shadow-xl hover:-translate-y-0.5",
  "erp-sync": "bg-surface-container-high/90 shadow-xl hover:-translate-y-0.5",
  "slack-dispatch": "bg-surface-container-high/90 shadow-xl hover:-translate-y-0.5",
};

export const MINIMAP_COLOR: Record<NodeKind, string> = {
  webhook: "bg-secondary opacity-80",
  "stripe-auth": "bg-primary ring-1 ring-primary",
  "evaluate-tier": "bg-secondary-fixed opacity-80",
  "erp-sync": "bg-primary-container opacity-80",
  "slack-dispatch": "bg-tertiary opacity-80",
};
