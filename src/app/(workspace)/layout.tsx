import { Sidebar } from "@/components/shell/sidebar";
import { StatusBar } from "@/components/shell/status-bar";
import { TopBar } from "@/components/shell/top-bar";
import { ProductionGuard } from "@/components/shell/production-guard";
import { ViewOnlyBanner } from "@/components/shell/view-only-banner";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="pl-[var(--sidebar-w)] transition-[padding] flex flex-col min-h-screen">
        <TopBar />
        <main className="relative pt-14 bg-surface flex-1 w-full">
          <ViewOnlyBanner />
          {children}
        </main>
        <StatusBar />
      </div>
      <ProductionGuard />
    </>
  );
}
