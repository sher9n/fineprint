"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * A small explanatory popover. Opens on hover (desktop) and on click/tap (touch). Rendered
 * through a portal with fixed positioning so it is never clipped by a parent's overflow:hidden
 * (e.g. cards) or rounded corners. Stops click propagation so it can live inside a stretched
 * link without navigating.
 */
export function Hint({ children, title, body, width = 300, className }: {
  children: ReactNode;
  title?: string;
  body: ReactNode;
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const showT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideT = useRef<ReturnType<typeof setTimeout> | null>(null);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const w = Math.min(width, window.innerWidth - 24);
    let left = r.left;
    if (left + w > window.innerWidth - 12) left = window.innerWidth - 12 - w;
    if (left < 12) left = 12;
    setPos({ top: r.bottom + 8, left });
  };
  const show = () => { if (hideT.current) clearTimeout(hideT.current); showT.current = setTimeout(() => { place(); setOpen(true); }, 110); };
  const hide = () => { if (showT.current) clearTimeout(showT.current); hideT.current = setTimeout(() => setOpen(false), 100); };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onEsc);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); window.removeEventListener("keydown", onEsc); };
  }, [open]);

  const w = Math.min(width, typeof window !== "undefined" ? window.innerWidth - 24 : width);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (open) { setOpen(false); } else { place(); setOpen(true); } }}
        className={cn("inline-flex items-center text-left cursor-help", className)}
        aria-expanded={open}
      >
        {children}
      </button>
      {open && pos && typeof document !== "undefined" && createPortal(
        <div
          role="tooltip"
          onMouseEnter={() => { if (hideT.current) clearTimeout(hideT.current); }}
          onMouseLeave={hide}
          className="fixed z-[70] animate-fade-in"
          style={{ top: pos.top, left: pos.left, width: w }}
        >
          <div className="card-elev p-3.5">
            {title && <div className="text-[13px] font-semibold text-[var(--text)] mb-1.5">{title}</div>}
            <div className="text-[12.5px] leading-relaxed text-[var(--text-muted)] space-y-2">{body}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
