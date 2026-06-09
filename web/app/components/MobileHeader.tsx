"use client";

import { Menu } from "lucide-react";

interface MobileHeaderProps {
  onMenu: () => void;
}

export function MobileHeader({ onMenu }: MobileHeaderProps) {
  return (
    <header className="flex h-14 items-center border-b border-hairline bg-sidebar px-3 md:hidden">
      <button
        type="button"
        aria-label="Open sidebar"
        onClick={onMenu}
        className="flex h-9 w-9 items-center justify-center rounded-[4px] text-canvas hover:bg-surface-dark-elevated"
      >
        <Menu size={20} />
      </button>
      <div className="mx-auto text-[15px] font-bold">CAKE Core</div>
      <div className="h-9 w-9" />
    </header>
  );
}
