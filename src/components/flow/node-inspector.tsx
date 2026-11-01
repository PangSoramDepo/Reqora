"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { REQUEST_HEADERS } from "./data";

const TABS = ["Headers (3)", "Body (JSON)", "Outputs", "Settings"] as const;
type Tab = (typeof TABS)[number];

const SECTION_LABEL = "font-label-sm text-label-sm text-outline uppercase tracking-wider";
const CODE_BLOCK = "p-space-sm rounded-lg bg-surface-container-lowest font-mono text-[11px] shadow-inner overflow-x-auto";
const ICON_BUTTON =
  "p-space-xs rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors";

const REQUEST_URL = "https://api.stripe.com/v1/customers/verify";

function HeadersPanel() {
  return (
    <div className="flex flex-col gap-space-xs">
      <div className="flex items-center justify-between">
        <span className={SECTION_LABEL}>Request Headers</span>
        <button className="text-primary font-label-sm text-label-sm hover:underline" type="button">
          + Add Header
        </button>
      </div>
      <div className="flex flex-col gap-space-xxs">
        {REQUEST_HEADERS.map((header) => (
          <div
            key={header.name}
            className="flex items-center gap-space-xs p-space-xs rounded bg-surface-container-lowest font-mono text-body-sm"
          >
            <span className="text-on-surface-variant w-28 truncate">{header.name}</span>
            <span className="text-outline">:</span>
            <span className={`${header.tone} flex-1 truncate`}>{header.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BodyPanel() {
  return (
    <div className="flex flex-col gap-space-xs">
      <div className="flex items-center justify-between">
        <span className={SECTION_LABEL}>Payload Interpolation</span>
        <span className="font-label-sm text-label-sm text-primary font-mono">JSON Valid</span>
      </div>
      <div className={`${CODE_BLOCK} leading-relaxed text-on-surface`}>
        <div>{"{"}</div>
        <div className="pl-3">
          <span className="text-primary">&quot;account_token&quot;</span>:{" "}
          <span className="text-tertiary">&quot;{"{{node_1.payload.order.id}}"}&quot;</span>,
        </div>
        <div className="pl-3">
          <span className="text-primary">&quot;expected_amount&quot;</span>:{" "}
          <span className="text-tertiary">{"{{node_1.payload.order.amount}}"}</span>,
        </div>
        <div className="pl-3">
          <span className="text-primary">&quot;risk_eval&quot;</span>: <span className="text-secondary">true</span>
        </div>
        <div>{"}"}</div>
      </div>
    </div>
  );
}

function OutputsPanel() {
  return (
    <div className="flex flex-col gap-space-xs">
      <span className={SECTION_LABEL}>Output Ports</span>
      {[
        { path: "res.verified", alias: "cust_status", dot: "bg-secondary" },
        { path: "res.customer", alias: "customer.id", dot: "bg-primary" },
      ].map((port) => (
        <div
          key={port.path}
          className="flex items-center gap-space-xs p-space-xs rounded bg-surface-container-lowest font-mono text-body-sm"
        >
          <span className={`w-2 h-2 rounded-full ${port.dot}`} />
          <span className="text-on-surface-variant flex-1">{port.path}</span>
          <span className="text-outline">→</span>
          <span className="text-primary">{port.alias}</span>
        </div>
      ))}
    </div>
  );
}

function SettingsPanel() {
  return (
    <div className="flex flex-col gap-space-xs">
      <span className={SECTION_LABEL}>Execution Settings</span>
      {[
        { label: "Timeout", value: "10000 ms" },
        { label: "Retries", value: "3 (exponential)" },
        { label: "On failure", value: "Halt flow" },
      ].map((setting) => (
        <div
          key={setting.label}
          className="flex items-center justify-between p-space-xs rounded bg-surface-container-lowest font-mono text-body-sm"
        >
          <span className="text-on-surface-variant">{setting.label}</span>
          <span className="text-on-surface">{setting.value}</span>
        </div>
      ))}
    </div>
  );
}

const PANELS: Record<Tab, () => React.ReactNode> = {
  "Headers (3)": HeadersPanel,
  "Body (JSON)": BodyPanel,
  Outputs: OutputsPanel,
  Settings: SettingsPanel,
};

export function NodeInspector({ onTestRequest }: { onTestRequest: () => void }) {
  const [tab, setTab] = useState<Tab>("Headers (3)");
  const [url, setUrl] = useState(REQUEST_URL);
  const [copied, setCopied] = useState(false);

  const copyCurl = async () => {
    await navigator.clipboard.writeText(
      `curl -X POST '${url}' -H 'Authorization: Bearer $STRIPE_SECRET' -H 'Content-Type: application/json' -H 'Stripe-Version: 2023-10-16'`,
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <aside className="w-[380px] h-full bg-surface-container-low/95 backdrop-blur-xl z-30 flex flex-col shadow-2xl overflow-y-auto">
      <div className="h-14 shrink-0 px-space-md flex items-center justify-between bg-surface-container-lowest/70">
        <div className="flex items-center gap-space-xs">
          <Icon name="tune" className="text-primary text-headline-sm" />
          <div className="flex flex-col">
            <span className="font-headline-sm text-headline-sm text-on-surface font-semibold leading-tight">
              Node Inspector
            </span>
            <span className="font-label-sm text-label-sm text-outline">POST #node-2 (Stripe Customer)</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button className={ICON_BUTTON} title="Node Documentation" type="button">
            <Icon name="help_outline" className="text-body-md" />
          </button>
          <button className={ICON_BUTTON} title="Pin Panel" type="button">
            <Icon name="push_pin" className="text-body-md" />
          </button>
        </div>
      </div>

      <div className="p-space-md flex flex-col gap-space-md flex-1">
        <div className="flex flex-col gap-space-xs">
          <label className={SECTION_LABEL} htmlFor="request-target">
            Request Target
          </label>
          <div className="flex items-center rounded-lg bg-surface-container-lowest overflow-hidden shadow-inner">
            <span className="px-space-sm py-space-xs bg-primary text-on-primary font-label-sm text-label-sm font-bold uppercase">
              POST
            </span>
            <input
              id="request-target"
              className="bg-transparent font-mono text-body-sm text-on-surface px-space-sm py-space-xs w-full focus:outline-none"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center gap-space-xs rounded bg-surface-container p-0.5" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              className={`flex-1 py-1 text-center font-label-md text-label-md rounded ${
                tab === t
                  ? "bg-surface-container-highest text-primary font-medium"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
              type="button"
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>

        {PANELS[tab]()}

        <div className="flex items-center gap-space-xs">
          <button
            className="flex-1 flex items-center justify-center gap-space-xs px-space-md py-space-sm bg-primary text-on-primary rounded-xl font-body-sm text-body-sm font-semibold hover:bg-primary-container transition-all active:scale-98 shadow-lg"
            type="button"
            onClick={onTestRequest}
          >
            <Icon name="play_arrow" className="text-body-md" />
            <span>Test This Request</span>
          </button>
          <button
            className="p-space-sm bg-surface-container rounded-xl text-on-surface-variant hover:text-on-surface transition-colors"
            title="Copy cURL"
            type="button"
            onClick={copyCurl}
          >
            <Icon name={copied ? "check" : "content_copy"} className="text-body-md" />
          </button>
        </div>

        <div className="flex flex-col gap-space-xs mt-space-xs">
          <div className="flex items-center justify-between">
            <span className={SECTION_LABEL}>Live Response (Mocked)</span>
            <div className="flex items-center gap-space-xxs">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              <span className="font-label-sm text-label-sm text-primary font-bold">200 OK • 114ms</span>
            </div>
          </div>
          <div className={`${CODE_BLOCK} leading-snug text-on-surface-variant max-h-36`}>
            <div>{"{"}</div>
            <div className="pl-3 text-on-surface">
              <span className="text-primary">&quot;status&quot;</span>:{" "}
              <span className="text-secondary">&quot;verified&quot;</span>,
            </div>
            <div className="pl-3 text-on-surface">
              <span className="text-primary">&quot;customer_id&quot;</span>:{" "}
              <span className="text-tertiary">&quot;cus_OqL32a8m&quot;</span>,
            </div>
            <div className="pl-3 text-on-surface">
              <span className="text-primary">&quot;risk_score&quot;</span>: <span className="text-tertiary">12</span>,
            </div>
            <div className="pl-3 text-on-surface">
              <span className="text-primary">&quot;tier_eligible&quot;</span>: <span className="text-secondary">true</span>
            </div>
            <div>{"}"}</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
