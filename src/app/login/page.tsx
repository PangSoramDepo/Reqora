import type { Metadata } from "next";
import { Suspense } from "react";
import { Icon } from "@/components/icon";
import { LoginForm } from "@/components/auth/login-form";
import { PipelinePreview } from "@/components/auth/pipeline-preview";

export const metadata: Metadata = {
  title: "Sign In",
};

export default function LoginPage() {
  return (
    <main className="relative bg-surface flex-1 w-full min-h-screen">
      <div className="relative w-full min-h-screen overflow-hidden flex flex-col justify-between py-space-xl px-margin">
        <div className="pointer-events-none absolute inset-0 z-0 opacity-20">
          <svg className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <pattern height="24" id="dot-matrix" patternUnits="userSpaceOnUse" width="24">
                <circle cx="2" cy="2" fill="#4cd7f6" fillOpacity="0.35" r="1.25" />
              </pattern>
            </defs>
            <rect fill="url(#dot-matrix)" height="100%" width="100%" />
          </svg>
        </div>
        <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 w-[720px] h-[360px] bg-primary/10 blur-[130px] rounded-full" />
        <div className="pointer-events-none absolute top-1/3 -right-32 w-[480px] h-[480px] bg-secondary-container/20 blur-[150px] rounded-full" />
        <div className="pointer-events-none absolute bottom-0 -left-20 w-[420px] h-[420px] bg-primary-container/15 blur-[140px] rounded-full" />

        <header className="relative z-10 w-full max-w-7xl mx-auto flex items-center justify-between pb-space-lg">
          <div className="flex items-center gap-space-md">
            <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-surface-container-high shadow-lg">
              <div className="absolute inset-0 rounded-xl bg-primary/20 blur-sm" />
              <Icon name="hub" className="text-primary text-headline-lg relative z-10" style={{ fontVariationSettings: "'FILL' 1" }} />
            </div>
            <div>
              <div className="flex items-center gap-space-xs">
                <span className="font-headline-md text-headline-md tracking-tight text-on-surface font-semibold">Reqora</span>
                <span className="px-space-xs py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm uppercase tracking-widest font-semibold">
                  v0.1
                </span>
              </div>
              <p className="font-label-sm text-label-sm text-on-surface-variant tracking-wide uppercase">
                Visual API Orchestration &amp; Flow Engineering Platform
              </p>
            </div>
          </div>
        </header>

        <div className="relative z-10 w-full max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-space-2xl items-center my-auto py-space-lg">
          <div className="lg:col-span-6 flex flex-col gap-space-xl">
            {/* Reads ?next= from the URL, which needs a Suspense boundary under Cache Components. */}
            <Suspense fallback={<div className="h-[640px] rounded-xl bg-surface-container-low/90" />}>
              <LoginForm />
            </Suspense>
          </div>
          <div className="lg:col-span-6 flex flex-col gap-space-xl pl-0 lg:pl-space-xl">
            <PipelinePreview />
          </div>
        </div>

        <footer className="relative z-10 w-full max-w-7xl mx-auto pt-space-lg flex flex-col md:flex-row items-center justify-between gap-space-md border-t border-surface-variant/30 text-on-surface-variant font-label-sm text-label-sm">
          <div className="flex flex-wrap items-center gap-space-lg justify-center md:justify-start">
            <span className="flex items-center gap-1.5 text-on-surface">
              <Icon name="lock" className="text-primary text-[14px]" />
              Secrets encrypted at rest (AES-256-GCM)
            </span>
            <span className="flex items-center gap-1.5 text-on-surface">
              <Icon name="key" className="text-primary text-[14px]" />
              Passwords hashed with scrypt
            </span>
          </div>
          <span>Self-hosted · your data stays on this server</span>
        </footer>
      </div>
    </main>
  );
}
