"use client";

import { useState } from "react";
import { Check, ChevronDown, Circle, LoaderCircle } from "lucide-react";
import { getApiBase, type CakeModel } from "../lib/cake-api";
import type { ServerState } from "./types";

interface NavBarProps {
  models: CakeModel[];
  selectedModel: string;
  serverState: ServerState;
  onSelectModel: (model: string) => void;
  onRefreshModels: () => void;
}

export function NavBar({
  models,
  selectedModel,
  serverState,
  onSelectModel,
  onRefreshModels,
}: NavBarProps) {
  const [open, setOpen] = useState(false);
  const stateLabel = {
    checking: "checking",
    online: "online",
    offline: "offline",
  }[serverState];

  return (
    <header className="flex h-18 shrink-0 items-center justify-between border-b border-hairline bg-workspace px-4 md:px-6">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 rounded-sm px-2 py-1 text-left text-[17px] font-bold leading-6 hover:bg-surface-dark-elevated md:text-[20px]"
        >
          {selectedModel}
          {open ? <ChevronDown size={18} className="rotate-180" /> : <ChevronDown size={18} />}
        </button>
        <button
          type="button"
          onClick={onRefreshModels}
          className="ml-2 text-[7px] leading-5 text-ash hover:text-canvas"
        >
          Set as default · {stateLabel}
        </button>
        {open && (
          <div className="absolute left-0 top-14 z-20 w-70 border border-hairline bg-sidebar p-1">
            {(models.length > 0 ? models : [{ id: "cake" }]).map((model) => (
              <button
                key={model.id}
                type="button"
                onClick={() => {
                  onSelectModel(model.id);
                  setOpen(false);
                }}
                className="flex h-10 w-full items-center justify-between rounded-sm px-3 text-left text-[14px] hover:bg-surface-dark-elevated"
              >
                <span className="truncate">{model.id}</span>
                {model.id === selectedModel && <Check size={16} />}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <StatusDot state={serverState} />
        <div className="hidden h-8 items-center border border-hairline px-3 text-[12px] text-ash sm:flex">
          CAKE API {getApiBase().replace(/^https?:\/\//, "")}
        </div>
      </div>
    </header>
  );
}

function StatusDot({ state }: { state: ServerState }) {
  const color =
    state === "online"
      ? "text-success"
      : state === "offline"
        ? "text-danger"
        : "text-warning";

  return (
    <div
      title={`Server ${state}`}
      className={`flex h-9 w-9 items-center justify-center rounded-sm border border-hairline ${color}`}
    >
      {state === "checking" ? (
        <LoaderCircle className="animate-spin" size={17} />
      ) : (
        <Circle size={14} fill="currentColor" />
      )}
    </div>
  );
}
