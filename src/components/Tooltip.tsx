"use client";

import { useState, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Tooltip({
  title,
  body,
  hint,
  align = "right",
  width = 320,
  children,
}: {
  title: string;
  body: ReactNode;
  hint?: string;
  align?: "left" | "center" | "right";
  width?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const showT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (hideT.current) clearTimeout(hideT.current);
    showT.current = setTimeout(() => setOpen(true), 220);
  };
  const hide = () => {
    if (showT.current) clearTimeout(showT.current);
    hideT.current = setTimeout(() => setOpen(false), 60);
  };

  const alignClass = align === "left" ? "left-0" : align === "right" ? "right-0" : "left-1/2 -translate-x-1/2";

  return (
    <span className="relative inline-block" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      <div
        role="tooltip"
        className={cn(
          "absolute top-full mt-2 z-50 pointer-events-none transition-all duration-150",
          alignClass,
          open ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
        )}
        style={{ width }}
      >
        <div className="card-elev overflow-hidden">
          <div className="px-3.5 py-2.5 border-b border-[var(--border)] flex items-baseline justify-between gap-3">
            <span className="text-[13px] font-medium text-[var(--text)]">{title}</span>
            {hint && <span className="text-[10px] text-[var(--text-dim)] mono uppercase tracking-wider whitespace-nowrap">{hint}</span>}
          </div>
          <div className="px-3.5 py-3 text-[12px] leading-relaxed text-[var(--text-muted)] space-y-1.5">{body}</div>
        </div>
      </div>
    </span>
  );
}
