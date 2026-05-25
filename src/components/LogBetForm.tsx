"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function LogBetForm({
  marketId,
  analysisId,
  yesPrice,
  noPrice,
  suggestedSide,
  onPlaced,
}: {
  marketId: string;
  analysisId?: string;
  yesPrice: number | null;
  noPrice: number | null;
  suggestedSide?: "YES" | "NO";
  onPlaced?: () => void;
}) {
  const { data: session } = useSession();
  const [side, setSide] = useState<"YES" | "NO">(suggestedSide || "YES");
  const [sizeUsd, setSizeUsd] = useState("50");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const priceAtBet = side === "YES" ? yesPrice : noPrice;

  async function submit() {
    if (!session) {
      toast.error("Sign in to track your bets");
      return;
    }
    if (priceAtBet == null) {
      toast.error("No price available");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/bets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ marketId, analysisId, side, priceAtBet, sizeUsd: Number(sizeUsd), rationale }),
      });
      if (!res.ok) throw new Error("fail");
      setDone(true);
      setTimeout(() => setDone(false), 1500);
      setRationale("");
      onPlaced?.();
      toast.success("Bet logged");
    } catch {
      toast.error("Could not log bet");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Track your bet</h3>
        <span className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">manual log</span>
      </div>
      <p className="text-xs text-[var(--text-muted)] -mt-1">
        Place the actual bet on Polymarket, then record it here so we can track your results over time.
      </p>

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSide("YES")}
          className={cn(
            "btn justify-center",
            side === "YES" && "border-[var(--green)] bg-[var(--green-soft)] text-[var(--green)]"
          )}
        >
          YES {yesPrice != null && <span className="mono ml-1 opacity-70">{(yesPrice * 100).toFixed(0)}¢</span>}
        </button>
        <button
          onClick={() => setSide("NO")}
          className={cn(
            "btn justify-center",
            side === "NO" && "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
          )}
        >
          NO {noPrice != null && <span className="mono ml-1 opacity-70">{(noPrice * 100).toFixed(0)}¢</span>}
        </button>
      </div>

      <div>
        <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">How much did you bet (USD)?</label>
        <input className="input mono mt-1" type="number" value={sizeUsd} onChange={(e) => setSizeUsd(e.target.value)} />
      </div>

      <div>
        <label className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">Why? (optional)</label>
        <textarea
          className="input mt-1"
          rows={2}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="e.g. The rules require a specific deadline that won't be met"
        />
      </div>

      <button className="btn btn-primary w-full" onClick={submit} disabled={busy || priceAtBet == null}>
        {done ? <><Check className="w-4 h-4" /> Logged</> : busy ? "Saving…" : "Log this bet"}
      </button>
    </div>
  );
}
