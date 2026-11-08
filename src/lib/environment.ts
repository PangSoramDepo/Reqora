"use client";

import { useSyncExternalStore } from "react";
import { ENVIRONMENTS, type Environment } from "@/lib/workflows/schema";

const KEY = "reqora:environment";
const EVENT = "reqora:environment-change";

export const ENVIRONMENT_LABELS: Record<Environment, { label: string; region: string; tone: string; dot: string }> = {
  production: { label: "Production", region: "US-East", tone: "text-tertiary", dot: "bg-tertiary" },
  staging: { label: "Staging", region: "EU-West", tone: "text-secondary", dot: "bg-secondary" },
  sandbox: { label: "Sandbox", region: "Local", tone: "text-primary", dot: "bg-primary" },
};

function read(): Environment {
  try {
    const value = localStorage.getItem(KEY);
    // Never chosen: Sandbox, so a first test run can't touch live APIs.
    return ENVIRONMENTS.includes(value as Environment) ? (value as Environment) : "sandbox";
  } catch {
    return "sandbox";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function setEnvironment(environment: Environment) {
  try {
    localStorage.setItem(KEY, environment);
  } catch {
    // Storage unavailable (private mode); the change still applies for this page view.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The environment selected in the top bar; used for canvas test runs and the Secrets page. */
export function useEnvironment(): Environment {
  return useSyncExternalStore(subscribe, read, () => "sandbox");
}
