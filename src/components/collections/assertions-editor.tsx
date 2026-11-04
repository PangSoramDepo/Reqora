"use client";

import { Icon } from "@/components/icon";
import type { Assertion } from "@/lib/collections/schema";
import { FIELD, SELECT } from "./ui";

const TYPES: { type: Assertion["type"]; label: string; make: () => Assertion }[] = [
  { type: "status", label: "Status code equals", make: () => ({ type: "status", equals: 200 }) },
  { type: "responseTimeBelow", label: "Response time below", make: () => ({ type: "responseTimeBelow", ms: 500 }) },
  { type: "headerContains", label: "Header contains", make: () => ({ type: "headerContains", header: "content-type", value: "json" }) },
  { type: "bodyContains", label: "Body contains", make: () => ({ type: "bodyContains", text: "" }) },
  { type: "jsonPathEquals", label: "JSON path equals", make: () => ({ type: "jsonPathEquals", path: "", value: "" }) },
  { type: "jsonPathExists", label: "JSON path exists", make: () => ({ type: "jsonPathExists", path: "" }) },
];

type Props = {
  assertions: Assertion[];
  onChange: (update: (assertions: Assertion[]) => Assertion[]) => void;
};

const SMALL = `${FIELD} py-1`;

function Fields({ a, set }: { a: Assertion; set: (a: Assertion) => void }) {
  switch (a.type) {
    case "status":
      return (
        <input
          aria-label="Expected status"
          type="number"
          min={100}
          max={599}
          className={`${SMALL} w-24`}
          value={a.equals}
          onChange={(e) => set({ ...a, equals: Math.trunc(Number(e.target.value)) || 0 })}
        />
      );
    case "responseTimeBelow":
      return (
        <span className="flex items-center gap-1">
          <input
            aria-label="Max response time"
            type="number"
            min={1}
            className={`${SMALL} w-28`}
            value={a.ms}
            onChange={(e) => set({ ...a, ms: Math.max(1, Math.trunc(Number(e.target.value)) || 1) })}
          />
          <span className="text-outline font-label-sm text-label-sm">ms</span>
        </span>
      );
    case "headerContains":
      return (
        <>
          <input aria-label="Header name" placeholder="header" className={`${SMALL} w-40`} value={a.header} onChange={(e) => set({ ...a, header: e.target.value })} />
          <input aria-label="Header must contain" placeholder="contains…" className={SMALL} value={a.value} onChange={(e) => set({ ...a, value: e.target.value })} />
        </>
      );
    case "bodyContains":
      return <input aria-label="Body must contain" placeholder="text" className={SMALL} value={a.text} onChange={(e) => set({ ...a, text: e.target.value })} />;
    case "jsonPathEquals":
      return (
        <>
          <input aria-label="JSON path" placeholder="customer.id" className={`${SMALL} w-48`} value={a.path} onChange={(e) => set({ ...a, path: e.target.value })} />
          <span className="text-outline">=</span>
          <input aria-label="Expected value" placeholder="expected" className={SMALL} value={a.value} onChange={(e) => set({ ...a, value: e.target.value })} />
        </>
      );
    case "jsonPathExists":
      return <input aria-label="JSON path" placeholder="items.0.sku" className={`${SMALL} w-64`} value={a.path} onChange={(e) => set({ ...a, path: e.target.value })} />;
  }
}

/** Declarative response checks; there is deliberately no scripting. */
export function AssertionsEditor({ assertions, onChange }: Props) {
  return (
    <div className="flex-1 overflow-auto p-space-sm flex flex-col gap-space-xs">
      {assertions.length === 0 && (
        <p className="font-body-sm text-body-sm text-on-surface-variant">
          No tests yet. Tests run after every send — e.g. check the status code, a header, or a JSON path like{" "}
          <code className="text-primary">customer.id</code>.
        </p>
      )}
      {assertions.map((a, index) => (
        <div key={index} className="flex items-center gap-space-xs bg-surface-container-low rounded px-space-xs py-1">
          <Icon name="rule" className="text-body-md text-secondary" />
          <select
            aria-label="Test type"
            className={SELECT}
            value={a.type}
            onChange={(e) => {
              const next = TYPES.find((t) => t.type === e.target.value)!.make();
              onChange((list) => list.map((x, i) => (i === index ? next : x)));
            }}
          >
            {TYPES.map((t) => (
              <option key={t.type} value={t.type}>
                {t.label}
              </option>
            ))}
          </select>
          <div className="flex-1 flex items-center gap-space-xs min-w-0">
            <Fields a={a} set={(next) => onChange((list) => list.map((x, i) => (i === index ? next : x)))} />
          </div>
          <button
            type="button"
            title="Remove test"
            onClick={() => onChange((list) => list.filter((_, i) => i !== index))}
            className="p-0.5 rounded text-outline hover:text-error"
          >
            <Icon name="delete" className="text-body-md" />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-space-xs pt-space-xs">
        {TYPES.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => onChange((list) => [...list, t.make()])}
            className="flex items-center gap-1 px-space-xs py-space-xxs rounded bg-surface-container-high hover:bg-surface-container-highest text-on-surface-variant font-label-sm text-label-sm"
          >
            <Icon name="add" className="text-body-sm text-primary" /> {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}
