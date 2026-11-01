"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icon";

const NAV_ITEMS = [
  { href: "/flow", icon: "schema", label: "Flow Canvas" },
  { href: "/executions", icon: "history", label: "Execution History" },
  { href: "/secrets", icon: "key", label: "Environment Secrets" },
  { href: "/telemetry", icon: "monitoring", label: "Telemetry & Metrics" },
] as const;

const BASE = "flex items-center gap-space-xs px-space-sm py-space-xs transition-colors rounded";
const ACTIVE = `${BASE} bg-surface-container-high text-primary font-medium`;
const IDLE = `${BASE} text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-body-sm text-body-sm`;

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-space-xxs">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={active ? ACTIVE : IDLE}
          >
            <Icon name={item.icon} className="text-body-md" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
