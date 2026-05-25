"use client";

import { LayoutGrid, List } from "lucide-react";
import { cn } from "@/lib/utils";

export type ViewMode = "cards" | "list";

export function ViewSwitcher({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)]" role="radiogroup" aria-label="View mode">
      <button
        role="radio"
        aria-checked={value === "cards"}
        onClick={() => onChange("cards")}
        title="Card view"
        className={cn(
          "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
          value === "cards" ? "bg-[var(--bg-elev)] text-[var(--text)] shadow-sm" : "text-[var(--text-dim)] hover:text-[var(--text)]"
        )}
      >
        <LayoutGrid className="w-3.5 h-3.5" />
      </button>
      <button
        role="radio"
        aria-checked={value === "list"}
        onClick={() => onChange("list")}
        title="List view"
        className={cn(
          "inline-flex items-center justify-center w-7 h-7 rounded-md transition-colors",
          value === "list" ? "bg-[var(--bg-elev)] text-[var(--text)] shadow-sm" : "text-[var(--text-dim)] hover:text-[var(--text)]"
        )}
      >
        <List className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
