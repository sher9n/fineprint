"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-[88px] h-9" />;

  const options: { v: string; icon: typeof Sun; label: string }[] = [
    { v: "light", icon: Sun, label: "Light" },
    { v: "dark", icon: Moon, label: "Dark" },
    { v: "system", icon: Monitor, label: "Auto" },
  ];

  return (
    <div role="radiogroup" aria-label="Theme" className={cn("inline-flex items-center gap-0.5 p-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elev-2)]")}>
      {options.map((o) => {
        const Icon = o.icon;
        const active = theme === o.v;
        return (
          <button
            key={o.v}
            role="radio"
            aria-checked={active}
            onClick={() => setTheme(o.v)}
            title={o.label}
            className={cn(
              "inline-flex items-center justify-center rounded-md transition-colors",
              compact ? "w-7 h-7" : "w-8 h-8",
              active ? "bg-[var(--bg-elev)] text-[var(--text)] shadow-sm" : "text-[var(--text-dim)] hover:text-[var(--text)]"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
