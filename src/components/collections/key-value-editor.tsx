"use client";

import { Icon } from "@/components/icon";
import type { KeyValue } from "@/lib/collections/schema";
import { TemplateInput } from "./template-field";

type Props = {
  rows: KeyValue[];
  /** Functional update so token insertion never writes a stale list. */
  onRows: (update: (rows: KeyValue[]) => KeyValue[]) => void;
  keyPlaceholder: string;
  valuePlaceholder?: string;
  label: string;
};

const CELL =
  "w-full bg-transparent px-space-sm py-1.5 text-on-surface font-code-block text-code-block placeholder:text-outline focus:outline-none focus:bg-surface-container";

/** Table of key/value rows with enable toggles; typing into the trailing blank row appends a new one. */
export function KeyValueEditor({ rows, onRows, keyPlaceholder, valuePlaceholder = "value or {{env.NAME}}", label }: Props) {
  const patch = (index: number, change: Partial<KeyValue>) =>
    onRows((current) => {
      if (index >= current.length) return [...current, { key: "", value: "", enabled: true, ...change }];
      return current.map((row, i) => (i === index ? { ...row, ...change } : row));
    });
  const display = [...rows, { key: "", value: "", enabled: true }];

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full table-fixed font-body-sm text-body-sm" aria-label={label}>
        <thead>
          <tr className="text-left">
            <th className="w-10" />
            <th className={`px-space-sm py-1 font-label-sm text-label-sm text-outline uppercase tracking-wider`}>Key</th>
            <th className={`px-space-sm py-1 font-label-sm text-label-sm text-outline uppercase tracking-wider`}>Value</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {display.map((row, index) => {
            const placeholder = index === rows.length;
            return (
              <tr key={index} className="group bg-surface-container-lowest odd:bg-surface-container-low/40">
                <td className="text-center">
                  {!placeholder && (
                    <input
                      type="checkbox"
                      aria-label={`Enable ${row.key || "row"}`}
                      checked={row.enabled}
                      onChange={(e) => patch(index, { enabled: e.target.checked })}
                      className="w-3.5 h-3.5 accent-primary cursor-pointer"
                    />
                  )}
                </td>
                <td>
                  <TemplateInput
                    className={`${CELL} ${row.enabled ? "" : "line-through text-outline"}`}
                    placeholder={keyPlaceholder}
                    aria-label={`${label} key ${index + 1}`}
                    value={row.key}
                    onValue={(key) => patch(index, { key })}
                  />
                </td>
                <td>
                  <TemplateInput
                    className={`${CELL} ${row.enabled ? "" : "text-outline"}`}
                    placeholder={valuePlaceholder}
                    aria-label={`${label} value ${index + 1}`}
                    value={row.value}
                    onValue={(value) => patch(index, { value })}
                  />
                </td>
                <td className="text-center">
                  {!placeholder && (
                    <button
                      type="button"
                      title="Remove"
                      onClick={() => onRows((current) => current.filter((_, i) => i !== index))}
                      className="p-0.5 rounded text-outline opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-error transition-opacity"
                    >
                      <Icon name="close" className="text-body-md" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
