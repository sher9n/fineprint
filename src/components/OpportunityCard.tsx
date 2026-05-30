"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  describeBet,
  resolutionTimeline,
  pickKind,
  upsidePercent,
} from "@/lib/explain";
import { TrustBadge } from "./TrustBadge";
import { MismatchStat, ScoreStat } from "./PickStats";
import { BookmarkButton } from "./BookmarkButton";

interface CardProps {
  id: string;
  question: string;
  eventTitle: string | null;
  groupItemTitle: string | null;
  imageUrl: string | null;
  yesPrice: number | null;
  noPrice: number | null;
  liquidity: number;
  endDate: string | null;
  verifyStage?: string;
  foundAt?: string | null;
  bookmarked?: boolean;
  analysis: {
    id: string;
    pass: string;
    model: string;
    divergenceScore: number;
    divergenceType: string;
    edgeDirection: string;
    betSide: string;
    edgeScore: number;
    priceGap: number | null;
    directionAgreement: boolean;
    ruleImpliedProbability: number | null;
    expectedYesPayoutCents: number | null;
    expectedNoPayoutCents: number | null;
    vibeInterpretation: string;
    literalInterpretation: string;
  } | null;
  votes: { up: number; down: number; mine: number };
}

export function OpportunityCard(p: CardProps) {
  if (!p.analysis) return null;
  const a = p.analysis;
  const bet = describeBet({
    betSide: a.betSide,
    yesPrice: p.yesPrice,
    noPrice: p.noPrice,
    expectedYesPayoutCents: a.expectedYesPayoutCents,
    expectedNoPayoutCents: a.expectedNoPayoutCents,
    ruleImpliedProbability: a.ruleImpliedProbability,
  });
  const hasBet = bet.entryCents != null && bet.evPercent != null && bet.evPercent > 0;
  const side = a.betSide === "YES" ? "YES" : a.betSide === "NO" ? "NO" : null;
  const isYes = side === "YES";
  const upside = upsidePercent(bet.entryCents);
  const kind = pickKind(a.pass, a.divergenceType);
  const title = p.eventTitle && p.groupItemTitle ? `${p.eventTitle}: ${p.groupItemTitle}` : p.question;
  const moneyK = p.liquidity >= 1000 ? `$${(p.liquidity / 1000).toFixed(0)}k` : `$${p.liquidity.toFixed(0)}`;

  return (
    <article className="card lift relative flex flex-col overflow-hidden">
      {/* Stretched link: whole card opens the detail page. Interactive controls sit above it. */}
      <Link href={`/markets/${p.id}`} className="absolute inset-0 z-0" aria-label={title} />

      <div className="p-5 sm:p-6 flex flex-col gap-4 flex-1">
        {/* Top: kind + trust */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-muted)]">{kind.label}</span>
          <TrustBadge stage={p.verifyStage} size="sm" />
        </div>

        {/* Headline */}
        <h3 className="font-display text-[20px] sm:text-[21px] leading-[1.25] text-[var(--text)] line-clamp-3">
          {title}
        </h3>

        {/* Meta */}
        <div className="text-[13px] text-[var(--text-muted)] -mt-1">
          {resolutionTimeline(p.endDate, p.groupItemTitle)}
          <span className="mx-2 text-[var(--text-dim)]">&middot;</span>
          <span className="mono">{moneyK}</span> in play
        </div>

        {/* Recommendation */}
        <div className="mt-auto">
          {hasBet && side ? (
            <div
              className={cn(
                "rounded-[var(--radius-md)] p-4",
                isYes ? "bg-[var(--green-soft)]" : "bg-[var(--red-soft)]"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[22px] leading-none text-[var(--text)]">
                  Buy <span className={isYes ? "text-[var(--green)]" : "text-[var(--red)]"}>{side}</span>
                </span>
                {upside != null && (
                  <span className={cn("mono text-[15px] font-bold", isYes ? "text-[var(--green)]" : "text-[var(--red)]")}>
                    +{upside}%
                  </span>
                )}
              </div>
              <div className="mt-1.5 text-[13px] text-[var(--text-muted)]">
                Costs <span className="mono text-[var(--text)]">{bet.entryCents!.toFixed(0)}c</span>, pays{" "}
                <span className="mono text-[var(--text)]">$1.00</span> if it happens
              </div>
            </div>
          ) : (
            <div className="rounded-[var(--radius-md)] p-4 bg-[var(--bg-sunken)] border border-dashed border-[var(--border-strong)]">
              <div className="font-display text-[17px] text-[var(--text)]">Worth watching</div>
              <div className="mt-1 text-[13px] text-[var(--text-muted)]">No clear bet at today&apos;s price. We&apos;ll keep an eye on it.</div>
            </div>
          )}
        </div>
      </div>

      {/* Footer: strength + save + open */}
      <div className="px-5 sm:px-6 py-3 border-t border-[var(--border)] flex items-center justify-between gap-x-3 gap-y-2.5 flex-wrap">
        <div className="relative z-10 flex items-center gap-2">
          <MismatchStat score={a.divergenceScore} isMispricing={a.pass === "obvious"} vibe={a.vibeInterpretation} literal={a.literalInterpretation} />
          <ScoreStat edgeScore={a.edgeScore} divergenceScore={a.divergenceScore} priceGap={a.priceGap} liquidity={p.liquidity} endDate={p.endDate} pass={a.pass} directionAgreement={a.directionAgreement} />
        </div>
        <div className="flex items-center gap-2.5 ml-auto shrink-0">
          <span className="relative z-10"><BookmarkButton marketId={p.id} initial={!!p.bookmarked} size="md" /></span>
          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent)]">
            <span className="xl:hidden">See why</span>
            <ArrowRight className="w-4 h-4" />
          </span>
        </div>
      </div>
    </article>
  );
}
