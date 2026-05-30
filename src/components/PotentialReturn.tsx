"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * A compact "put in $X, walk away with $Y" line for the recommendation hero. Each share pays $1
 * if the bet hits, so the payout for a stake is stake / price. Tone follows the bet side so it
 * sits inside the green (YES) or red (NO) hero.
 */
export function PotentialReturn({ betSide, yesPrice, noPrice, tone }: {
  betSide: string;
  yesPrice: number | null;
  noPrice: number | null;
  tone: "green" | "red";
}) {
  const [size, setSize] = useState(50);
  const presets = [25, 50, 100, 250];
  const side = betSide === "YES" || betSide === "NO" ? betSide : "YES";
  const priceFraction = side === "YES" ? yesPrice : noPrice ?? (yesPrice != null ? 1 - yesPrice : null);
  if (priceFraction == null || priceFraction <= 0 || priceFraction >= 1) return null;

  const win = size / priceFraction; // each winning share pays $1
  const profit = win - size;
  const c = tone === "green" ? "var(--green)" : "var(--red)";
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

  return (
    <div className="mt-5 pt-5 border-t" style={{ borderColor: `color-mix(in srgb, ${c} 22%, transparent)` }}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[13px] text-[var(--text-muted)]">Put in</span>
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setSize(p)}
            className={cn(
              "px-2.5 py-1 rounded-full text-[13px] font-semibold border transition-colors",
              size !== p && "text-[var(--text-muted)] border-[var(--border-strong)] hover:text-[var(--text)]"
            )}
            style={size === p ? { background: c, color: "#fff", borderColor: c } : undefined}
          >
            ${p}
          </button>
        ))}
        <span className="text-[13px] text-[var(--text-muted)] ml-1">and if it hits, you walk away with</span>
        <span className="mono font-bold text-[24px] leading-none" style={{ color: c }}>${fmt(win)}</span>
        <span className="text-[13px] font-semibold" style={{ color: c }}>(+${fmt(profit)} profit)</span>
      </div>
    </div>
  );
}
