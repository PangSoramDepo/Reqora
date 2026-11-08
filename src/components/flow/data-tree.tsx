"use client";

import { useState } from "react";
import { Icon } from "@/components/icon";
import { describe, joinKey, type DataSource } from "@/lib/workflows/template-suggest";
import { useTemplateData } from "./template-data";

/** Items of a list shown before "… N more". */
const LIST_PREVIEW = 5;

function Row({ path, name, value, depth, onPick }: { path: string; name: string; value: unknown; depth: number; onPick: (path: string) => void }) {
  const container = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 1);
  const entries: [string, string, unknown][] = !container
    ? []
    : Array.isArray(value)
      ? value.slice(0, LIST_PREVIEW).map((v, i) => [`[${i}]`, `${path}[${i}]`, v])
      : Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, joinKey(path, k), v]);

  return (
    <li>
      <div className="group flex items-center gap-1 rounded hover:bg-surface-container-high" style={{ paddingLeft: depth * 12 }}>
        {container ? (
          <button type="button" className="p-0.5 text-outline hover:text-on-surface" aria-label={open ? `Collapse ${name}` : `Expand ${name}`} onClick={() => setOpen((v) => !v)}>
            <Icon name={open ? "expand_more" : "chevron_right"} className="text-[14px]" />
          </button>
        ) : (
          <span className="w-[18px]" />
        )}
        <button
          type="button"
          className="flex-1 min-w-0 flex items-center gap-space-xs py-0.5 text-left"
          title={`Insert {{${path}}}`}
          data-path={path}
          onClick={() => onPick(path)}
        >
          <span className={`font-mono text-[11px] truncate ${container ? "text-primary" : "text-on-surface"}`}>{name}</span>
          <span className="ml-auto shrink-0 max-w-[55%] truncate font-mono text-[10px] text-outline">{describe(value)}</span>
          <Icon name="add_circle" className="text-[14px] text-primary opacity-0 group-hover:opacity-100 shrink-0" />
        </button>
      </div>
      {container && open && (
        <ul>
          {entries.map(([label, childPath, v]) => (
            <Row key={childPath} path={childPath} name={label} value={v} depth={depth + 1} onPick={onPick} />
          ))}
          {Array.isArray(value) && value.length > LIST_PREVIEW && (
            <li className="font-mono text-[10px] text-outline" style={{ paddingLeft: (depth + 1) * 12 + 18 }}>
              … {value.length - LIST_PREVIEW} more
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

/** An output as a tree whose fields are clickable: each click passes that field's template path. */
export function DataTree({ root, value, onPick }: { root: string; value: unknown; onPick: (path: string) => void }) {
  return (
    <ul className="flex flex-col" role="tree">
      {value !== null && typeof value === "object" ? (
        (Array.isArray(value) ? value.map((v, i) => [`[${i}]`, `${root}[${i}]`, v] as const) : Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, joinKey(root, k), v] as const)).map(
          ([label, path, v]) => <Row key={path} path={path} name={label} value={v} depth={0} onPick={onPick} />,
        )
      ) : (
        <Row path={root} name={root} value={value} depth={0} onPick={onPick} />
      )}
    </ul>
  );
}

const SOURCE_ICON: Record<string, string> = { trigger: "webhook", http: "http", transform: "transform", condition: "call_split", script: "code", call: "account_tree", delay: "hourglass_top", response: "output_circle" };

/**
 * What this node can read, as trees: click a field to insert `{{path}}` at the caret of the template field
 * you were editing (or copy it when none had focus).
 */
export function AvailableData() {
  const data = useTemplateData();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>("trigger");
  const [flash, setFlash] = useState<string | null>(null);
  if (!data) return null;

  const pick = async (path: string) => {
    const text = `{{${path}}}`;
    if (data.insert(text)) setFlash(`Inserted ${text}`);
    else {
      await navigator.clipboard.writeText(text).catch(() => undefined);
      setFlash(`Copied ${text} — click in a field first to insert`);
    }
    setTimeout(() => setFlash(null), 2500);
  };

  const sources: DataSource[] = data.sources;
  return (
    <div className="flex flex-col gap-space-xs rounded-lg bg-surface-container-lowest/60 p-space-xs" data-testid="available-data">
      <button
        type="button"
        className="flex items-center gap-space-xs font-label-sm text-label-sm text-outline uppercase tracking-wider hover:text-on-surface"
        aria-expanded={open}
        // Don't take focus from the template field being edited.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={open ? "expand_more" : "chevron_right"} className="text-body-md" />
        <Icon name="data_object" className="text-body-md text-primary" />
        Available data
        <span className="ml-auto normal-case tracking-normal text-outline">click a field to insert</span>
      </button>
      {open && (
        <div className="flex flex-col gap-space-xxs" onMouseDown={(e) => e.preventDefault()}>
          {sources.map((s) => (
            <div key={s.root} className="flex flex-col">
              <button
                type="button"
                className="flex items-center gap-space-xs px-space-xs py-1 rounded hover:bg-surface-container text-left"
                aria-expanded={expanded === s.root}
                onClick={() => setExpanded(expanded === s.root ? null : s.root)}
              >
                <Icon name={SOURCE_ICON[s.type] ?? "data_object"} className="text-body-md text-primary" />
                <span className="font-mono text-[11px] text-on-surface truncate">{s.root}</span>
                <span className="font-body-sm text-body-sm text-outline truncate">{s.label}</span>
                {!s.ran && <span className="ml-auto shrink-0 font-label-sm text-label-sm text-outline">not run yet</span>}
              </button>
              {expanded === s.root && (
                <div className="pl-space-xs max-h-64 overflow-y-auto">
                  <DataTree root={s.root} value={s.value} onPick={pick} />
                </div>
              )}
            </div>
          ))}
          {data.env.length > 0 && (
            <div className="flex flex-col">
              <button
                type="button"
                className="flex items-center gap-space-xs px-space-xs py-1 rounded hover:bg-surface-container text-left"
                aria-expanded={expanded === "env"}
                onClick={() => setExpanded(expanded === "env" ? null : "env")}
              >
                <Icon name="key" className="text-body-md text-tertiary" />
                <span className="font-mono text-[11px] text-on-surface">env</span>
                <span className="font-body-sm text-body-sm text-outline">{data.env.length} variables</span>
              </button>
              {expanded === "env" && (
                <ul className="pl-space-md">
                  {data.env.map((name) => (
                    <li key={name}>
                      <button type="button" className="w-full text-left font-mono text-[11px] text-tertiary py-0.5 hover:bg-surface-container-high rounded px-1" onClick={() => pick(`env.${name}`)}>
                        {name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      {flash && (
        <span role="status" className="font-mono text-[10px] text-primary truncate" title={flash}>
          {flash}
        </span>
      )}
    </div>
  );
}
