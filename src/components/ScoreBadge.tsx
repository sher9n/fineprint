"use client";

import { cn } from "@/lib/utils";
import { opportunityScoreLabel } from "@/lib/explain";
import { Tooltip } from "./Tooltip";
import { Info } from "lucide-react";

interface ScoreBadgeProps {
  edgeScore: number;
  size?: "sm" | "md";
  divergenceScore?: number;
  priceGap?: number | null;
  liquidity?: number;
  endDate?: string | Date | null;
  pass?: string;
  directionAgreement?: boolean;
}

function numberColor(color: string): string {
  if (color === "green") return "text-[var(--green)]";
  if (color === "amber") return "text-[var(--amber)]";
  if (color === "accent") return "text-[var(--accent)]";
  return "text-[var(--text)]";
}

export function ScoreBadge(p: ScoreBadgeProps) {
  const t = opportunityScoreLabel(p.edgeScore);
  const labelSize = p.size === "sm" ? "text-[8px]" : "text-[9px]";
  const valueSize = p.size === "sm" ? "text-[11px]" : "text-[11px]";
  const containerSize = p.size === "sm" ? "px-1.5 py-0.5 gap-0.5" : "px-2 py-0.5 gap-1";

  const hasBreakdown = p.divergenceScore != null && p.liquidity != null;

  const chip = (
    <span
      className={cn(
        "inline-flex items-center rounded-md border whitespace-nowrap select-none",
        "bg-[var(--bg-elev-2)] border-[var(--border)]",
        containerSize,
        hasBreakdown && "cursor-default"
      )}
    >
      <span className={cn("uppercase tracking-wider text-[var(--text-dim)]", labelSize)}>Score</span>
      <span className={cn("mono font-semibold", valueSize, numberColor(t.color))}>{p.edgeScore.toFixed(0)}</span>
      {hasBreakdown && <Info className={cn("opacity-50 text-[var(--text-dim)] ml-0.5", p.size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3")} />}
    </span>
  );

  if (!hasBreakdown) return chip;

  const divergence = (p.divergenceScore ?? 0) / 10;
  const gap = p.priceGap ?? 0;
  const liquidityScore = Math.max(0, Math.min(1, Math.log10(Math.max(1, p.liquidity ?? 0)) / 5));
  const time = p.endDate ? timeFactor(p.endDate) : 0.5;
  const passWeight = p.pass === "opus" ? 1.0 : 0.85;
  const directionMult = p.directionAgreement !== false ? 1.0 : 0.6;
  const gapContrib = gap * 0.5;
  const divContrib = divergence * 0.3;
  const liqContrib = liquidityScore * 0.1;
  const timeContrib = time * 0.1;
  const rawTotal = gapContrib + divContrib + liqContrib + timeContrib;
  const days = p.endDate ? Math.max(0, (new Date(p.endDate).getTime() - Date.now()) / 86400000) : null;

  return (
    <Tooltip
      width={360}
      align="left"
      hint={`${p.edgeScore.toFixed(0)} / 100`}
      title="How this score is calculated"
      body={
        <>
          <p>The opportunity score blends four signals into a 0-100 number. Bigger is better.</p>
          <div className="mt-2 space-y-2 not-italic">
            <ScoreBar label="Price gap" detail={p.priceGap != null ? `${(gap * 100).toFixed(1)}pp` : "—"} weight="50%" value={gap} contribution={gapContrib} note="How much the market price disagrees with our literal-rules estimate" />
            <ScoreBar label="Mismatch level" detail={`${p.divergenceScore}/10`} weight="30%" value={divergence} contribution={divContrib} note="How big the gap is between the rules and what bettors assume" />
            <ScoreBar label="Liquidity" detail={`$${((p.liquidity ?? 0) / 1000).toFixed(0)}k`} weight="10%" value={liquidityScore} contribution={liqContrib} note="How much money is in the market (log scale)" />
            <ScoreBar label="Time to resolve" detail={days != null ? (days < 1 ? "<1d" : days < 60 ? `${Math.round(days)}d` : `${Math.round(days / 30)}mo`) : "—"} weight="10%" value={time} contribution={timeContrib} note="Faster resolution = more confident, sooner payout" />
          </div>
          <div className="mt-3 pt-2 border-t border-[var(--border)] space-y-1">
            <div className="flex justify-between text-[11px]"><span>Raw weighted total</span><span className="mono">{(rawTotal * 100).toFixed(1)}</span></div>
            {passWeight < 1 && <div className="flex justify-between text-[11px] text-[var(--text-muted)]"><span>Initial analysis (no web verification yet)</span><span className="mono">× 0.85</span></div>}
            {passWeight === 1 && p.pass === "opus" && <div className="flex justify-between text-[11px] text-[var(--green)]"><span>Confirmed by web search</span><span className="mono">× 1.0</span></div>}
            {directionMult < 1 && <div className="flex justify-between text-[11px] text-[var(--amber)]"><span>Model + math disagree on side</span><span className="mono">× 0.6</span></div>}
            <div className="flex justify-between text-[12px] font-medium pt-1 border-t border-[var(--border)]"><span>Final score</span><span className="mono">{p.edgeScore.toFixed(0)} / 100</span></div>
          </div>
          <p className="text-[10px] text-[var(--text-dim)] pt-1 mt-1 border-t border-[var(--border)]">70+ Strong · 50-69 Solid · 30-49 Worth a look · &lt;30 Marginal</p>
        </>
      }
    >
      {chip}
    </Tooltip>
  );
}

function timeFactor(endDate: string | Date): number {
  const d = typeof endDate === "string" ? new Date(endDate) : endDate;
  const days = (d.getTime() - Date.now()) / 86400000;
  if (days < 1) return 0;
  if (days <= 30) return 1;
  if (days <= 90) return 0.8;
  if (days <= 180) return 0.5;
  return 0.3;
}

function ScoreBar({ label, detail, weight, value, contribution, note }: { label: string; detail: string; weight: string; value: number; contribution: number; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--text)] font-medium">{label}</span>
        <span className="text-[var(--text-muted)] mono">{detail}</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <div className="flex-1 h-1.5 bg-[var(--bg-elev-2)] rounded-full overflow-hidden">
          <div className="h-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
        </div>
        <span className="text-[10px] text-[var(--text-dim)] mono w-10 text-right">+{(contribution * 100).toFixed(1)}</span>
        <span className="text-[10px] text-[var(--text-dim)] w-8 text-right">({weight})</span>
      </div>
      <div className="text-[10px] text-[var(--text-dim)] mt-0.5 leading-tight">{note}</div>
    </div>
  );
}
