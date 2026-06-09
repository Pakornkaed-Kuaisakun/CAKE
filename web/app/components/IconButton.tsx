import type { ReactNode } from "react";

interface IconButtonProps {
  title: string;
  children: ReactNode;
}

export function IconButton({ title, children }: IconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="flex h-9 w-9 items-center justify-center rounded-sm text-ash hover:bg-surface-dark-elevated hover:text-canvas"
    >
      {children}
    </button>
  );
}
