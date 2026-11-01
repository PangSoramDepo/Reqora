import { Sidebar } from "@/components/shell/sidebar";
import { StatusBar } from "@/components/shell/status-bar";
import { TopBar } from "@/components/shell/top-bar";

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      <div className="pl-64 flex flex-col min-h-screen">
        <TopBar />
        <main className="relative pt-14 bg-surface flex-1 w-full">{children}</main>
        <StatusBar />
      </div>
    </>
  );
}
