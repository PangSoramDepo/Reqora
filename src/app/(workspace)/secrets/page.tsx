import type { Metadata } from "next";
import { ConnectionsGrid } from "@/components/secrets/connections-grid";
import { KpiGrid } from "@/components/secrets/kpi-grid";
import { SecretsWorkspace } from "@/components/secrets/secrets-workspace";
import { UsageMatrix } from "@/components/secrets/usage-matrix";

export const metadata: Metadata = {
  title: "Environment Secrets",
};

export default function SecretsPage() {
  return <SecretsWorkspace kpis={<KpiGrid />} connections={<ConnectionsGrid />} matrix={<UsageMatrix />} />;
}
