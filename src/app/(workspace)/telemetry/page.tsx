import type { Metadata } from "next";
import { TelemetryDashboard } from "@/components/telemetry/telemetry-dashboard";

export const metadata: Metadata = {
  title: "Telemetry & Metrics",
};

export default function TelemetryPage() {
  return <TelemetryDashboard />;
}
