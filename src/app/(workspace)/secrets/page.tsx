import type { Metadata } from "next";
import { SecretsWorkspace } from "@/components/secrets/secrets-workspace";

export const metadata: Metadata = {
  title: "Environment Secrets",
};

export default function SecretsPage() {
  return <SecretsWorkspace />;
}
