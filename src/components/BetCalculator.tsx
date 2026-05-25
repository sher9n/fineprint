"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { NumberField } from "./NumberField";

export function BetCalculator({
  betSide,
  yesPrice,
  noPrice,
  expectedYesPayoutCents,
  expectedNoPayoutCents,
}: {
  betSide: string;
  yesPrice: number | null;
  noPrice: number | null;
  expectedYesPayoutCents: number | null;
  expectedNoPayoutCents: number | null;
}) {
  const [size, setSize] = useState(50);
  const presets = [10, 25, 50, 100, 250];

  const side = betSide === "YES" || betSide === "NO" ? betSide : "YES";
  const priceFraction = side === "YES" ? yesPrice : noPrice;
  if (priceFraction == null || priceFraction <= 0 || priceFraction >= 1) {
    return null;
  }
  const expectedCents = (side === "YES" ? expectedYesPayoutCents : expectedNoPayoutCents) ?? 0;
  const shares = size / priceFraction;
  const maxReturn = shares * 1.0;
  const expectedReturn = shares * (expectedCents / 100);
  const netExpected = expectedReturn - size;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="text-sm font-medium">How much could you make?</h3>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          Try different bet sizes to see your potential return.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {presets.map((p) => (
          <button
            key={p}
            onClick={() => setSize(p)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              size === p ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-elev-2)] text-[var(--text)] hover:bg-[var(--border)]"
            )}
          >
            ${p}
          </button>
        ))}
        <NumberField value={size} min={0} onChange={(v) => setSize(Math.max(0, v))} className="w-24" />
      </div>

      <div className="grid grid-cols-3 gap-3 pt-2 border-t border-[var(--border)]">
        <Stat label="You pay" value={`$${size.toFixed(0)}`} />
        <Stat label="If right, you get" value={`$${maxReturn.toFixed(2)}`} accent="green" />
        <Stat label="Expected return" value={`$${expectedReturn.toFixed(2)}`} sub={netExpected >= 0 ? `+$${netExpected.toFixed(2)}` : `-$${Math.abs(netExpected).toFixed(2)}`} accent={netExpected >= 0 ? "green" : "red"} />
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">
        &quot;Expected return&quot; is what you&apos;d get on average if our analysis is right. Real bets vary. Never bet more than you can afford to lose.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "red" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{label}</div>
      <div className={cn("text-lg font-semibold mt-0.5 mono", accent === "green" && "text-[var(--green)]", accent === "red" && "text-[var(--red)]")}>{value}</div>
      {sub && <div className={cn("text-xs mono mt-0.5", accent === "green" && "text-[var(--green)]", accent === "red" && "text-[var(--red)]")}>{sub}</div>}
    </div>
  );
}
