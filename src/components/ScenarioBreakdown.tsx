"use client";

import { cn } from "@/lib/utils";

interface Props {
  betSide: "YES" | "NO";
  entryCents: number;
  pYes: number;
  pNo: number;
  pFallback: number;
}

interface Row {
  label: string;
  prob: number;
  payoutCents: number;
}

/**
 * Renders the three possible outcomes for a market with a 50-50 fallback rule.
 * For each scenario: probability, payout per share at $1 stake, profit at the user's entry price.
 *
 * Sorts by probability descending so the most likely scenario is on top — usually the most
 * important one to internalize.
 */
export function ScenarioBreakdown({ betSide, entryCents, pYes, pNo, pFallback }: Props) {
  const rows: Row[] = [
    {
      label: "YES wins outright",
      prob: pYes,
      payoutCents: betSide === "YES" ? 100 : 0,
    },
    {
      label: "NO wins outright",
      prob: pNo,
      payoutCents: betSide === "NO" ? 100 : 0,
    },
    {
      label: "50-50 fallback (neither wins by deadline)",
      prob: pFallback,
      payoutCents: 50,
    },
  ].sort((a, b) => b.prob - a.prob);

  return (
    <div className="mt-3 pt-3 border-t border-[var(--green)]/15">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2">
        Three possible outcomes for a {betSide} bet
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const profitCents = r.payoutCents - entryCents;
          const positive = profitCents >= 0;
          return (
            <div key={r.label} className="flex items-baseline gap-2.5 text-xs sm:text-sm">
              <span className="mono tabular-nums text-[var(--text)] font-medium w-10 shrink-0 text-right">
                {(r.prob * 100).toFixed(r.prob >= 0.1 ? 0 : 1)}%
              </span>
              <span className="text-[var(--text)] flex-1 min-w-0">
                {r.label}
              </span>
              <span className="mono tabular-nums text-[var(--text-muted)] shrink-0">
                pays {(r.payoutCents).toFixed(0)}¢
              </span>
              <span className={cn(
                "mono tabular-nums shrink-0 font-medium w-16 text-right",
                positive ? "text-[var(--green)]" : "text-[var(--red)]"
              )}>
                {positive ? "+" : ""}{profitCents.toFixed(0)}¢
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
