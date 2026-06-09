"use client";

import { useState } from "react";
import { ChatWorkspace } from "./ChatWorkspace";
import { MobileHeader } from "./MobileHeader";
import { Sidebar } from "./Sidebar";

export function AppShell() {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <main className="flex h-dvh overflow-hidden bg-workspace text-canvas">
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <section className="flex min-w-0 flex-1 flex-col">
        <MobileHeader onMenu={() => setMobileSidebarOpen(true)} />
        <ChatWorkspace />
      </section>
    </main>
  );
}
