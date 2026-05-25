"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function Menu({ trigger, children, align = "end", width = 220 }: { trigger: ReactNode; children: ReactNode; align?: "start" | "center" | "end"; width?: number }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 card-elev p-1 animate-fade-in"
          style={{ width }}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuLink({ href, icon, children, danger }: { href: string; icon?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <DropdownMenu.Item asChild>
      <Link
        href={href}
        className={cn(
          "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm outline-none cursor-pointer",
          "text-[var(--text)] hover:bg-[var(--bg-elev-2)] data-[highlighted]:bg-[var(--bg-elev-2)]",
          danger && "text-[var(--red)] hover:bg-[var(--red-soft)] data-[highlighted]:bg-[var(--red-soft)]"
        )}
      >
        {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
        {children}
      </Link>
    </DropdownMenu.Item>
  );
}

export function MenuButton({ onClick, icon, children, danger }: { onClick: () => void; icon?: ReactNode; children: ReactNode; danger?: boolean }) {
  return (
    <DropdownMenu.Item
      onSelect={onClick}
      className={cn(
        "flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm outline-none cursor-pointer",
        "text-[var(--text)] hover:bg-[var(--bg-elev-2)] data-[highlighted]:bg-[var(--bg-elev-2)]",
        danger && "text-[var(--red)] hover:bg-[var(--red-soft)] data-[highlighted]:bg-[var(--red-soft)]"
      )}
    >
      {icon && <span className="text-[var(--text-muted)]">{icon}</span>}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">
      {children}
    </DropdownMenu.Label>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="h-px bg-[var(--border)] my-1 mx-1" />;
}
