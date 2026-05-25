"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronUp, ChevronDown, TrendingUp, AlertTriangle, Clock, BadgeCheck, ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  confidenceLabel,
  divergenceTypeLabel,
  describeBet,
  hasThreeWayStructure,
  humanizeTimeRemaining,
  stageLabel,
  timeAgo,
} from "@/lib/explain";
import { fmtIst } from "@/lib/time";
import { ScoreBadge } from "./ScoreBadge";
import { DivergenceTooltip } from "./DivergenceTooltip";
import { VerifyStageBadge } from "./VerifyStageBadge";

interface RowProps {
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
  analysis: {
    id: string;
    pass: string;
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
  } | null;
  votes: { up: number; down: number; mine: number };
}

export function OpportunityRow(p: RowProps) {
  const { data: session } = useSession();
  const [myVote, setMyVote] = useState<number>(p.votes.mine);
  const [up, setUp] = useState(p.votes.up);
  const [down, setDown] = useState(p.votes.down);
  const [voting, setVoting] = useState(false);

  if (!p.analysis) return null;
  const a = p.analysis;
  const conf = confidenceLabel(a.divergenceScore);
  const stage = stageLabel(a.pass);
  const bet = describeBet({
    betSide: a.betSide,
    yesPrice: p.yesPrice,
    noPrice: p.noPrice,
    expectedYesPayoutCents: a.expectedYesPayoutCents,
    expectedNoPayoutCents: a.expectedNoPayoutCents,
    ruleImpliedProbability: a.ruleImpliedProbability,
  });
  const threeWay = hasThreeWayStructure(a.expectedYesPayoutCents, a.expectedNoPayoutCents, a.ruleImpliedProbability);
  const displayQuestion = p.eventTitle && p.groupItemTitle ? `${p.eventTitle} — ${p.groupItemTitle}` : p.question;

  async function vote(dir: 1 | -1) {
    if (!session) {
      toast.error("Sign in to vote", { action: { label: "Sign in", onClick: () => (window.location.href = "/login") } });
      return;
    }
    if (voting) return;
    setVoting(true);
    const newDir = myVote === dir ? 0 : dir;
    const oldUp = up;
    const oldDown = down;
    const oldMine = myVote;
    setMyVote(newDir);
    setUp(up + (newDir === 1 ? 1 : 0) - (oldMine === 1 ? 1 : 0));
    setDown(down + (newDir === -1 ? 1 : 0) - (oldMine === -1 ? 1 : 0));
    try {
      const res = await fetch(`/api/markets/${p.id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ direction: newDir }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setUp(d.up); setDown(d.down); setMyVote(d.mine);
    } catch {
      setUp(oldUp); setDown(oldDown); setMyVote(oldMine);
      toast.error("Vote failed");
    } finally {
      setVoting(false);
    }
  }

  const hasBet = bet.entryCents != null && bet.evPercent != null && bet.evPercent > 0;

  // Accent border for second-opinion markets: green when both models agree, amber when they disagree.
  // The point is at-a-glance visibility — the badge below gives the precise label.
  const accentBorder =
    p.verifyStage === "synthesis_agreed"
      ? "border-l-2 border-l-[var(--green)]"
      : p.verifyStage === "synthesis_disagreed"
      ? "border-l-2 border-l-[var(--amber)]"
      : "";
  const foundLabel = p.foundAt ? timeAgo(p.foundAt) : null;

  return (
    <article className={cn("card px-4 py-3 hover:border-[var(--border-strong)] transition-colors group", accentBorder)}>
      <div className="flex items-center gap-3">
        <Link href={`/markets/${p.id}`} className="contents">
          {p.imageUrl && (
            <div className="shrink-0 w-9 h-9 rounded-lg overflow-hidden bg-[var(--bg-elev-2)] border border-[var(--border)]">
              <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <ScoreBadge
            edgeScore={a.edgeScore}
            size="sm"
            divergenceScore={a.divergenceScore}
            priceGap={a.priceGap}
            liquidity={p.liquidity}
            endDate={p.endDate}
            pass={a.pass}
            directionAgreement={a.directionAgreement}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium leading-snug truncate group-hover:text-[var(--accent)] transition-colors">{displayQuestion}</div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-[var(--text-muted)] flex-wrap">
              <Clock className="w-2.5 h-2.5 shrink-0" />
              <span>{humanizeTimeRemaining(p.endDate)}</span>
              <Dot />
              <span>${(p.liquidity / 1000).toFixed(0)}k liq</span>
              <Dot />
              <DivergenceTooltip divergenceScore={a.divergenceScore} divergenceType={a.divergenceType} size="sm" />
              <Dot />
              <span className="mono" title="YES / NO market price (cents per share)">
                {p.yesPrice != null ? `${(p.yesPrice * 100).toFixed(0)}¢` : "?"}/{p.noPrice != null ? `${(p.noPrice * 100).toFixed(0)}¢` : p.yesPrice != null ? `${((1 - p.yesPrice) * 100).toFixed(0)}¢` : "?"}
              </span>
              <Dot />
              {(a.betSide === "YES" || a.betSide === "NO") && (
                <>
                  <span title="The side our analysis suggests you buy">
                    bet <strong className={a.betSide === "YES" ? "text-[var(--green)]" : "text-[var(--red)]"}>{a.betSide}</strong>
                  </span>
                  <Dot />
                </>
              )}
              <span title={divergenceTypeLabel(a.divergenceType).explainer}>{divergenceTypeLabel(a.divergenceType).short}</span>
              {threeWay && (
                <>
                  <Dot />
                  <span className="inline-flex items-center gap-0.5 text-[var(--purple)]" title="This market has a tie-breaker rule (e.g. 50-50 fallback) that affects payouts"><AlertTriangle className="w-2.5 h-2.5" /> Tie-breaker</span>
                </>
              )}
              {p.verifyStage && p.verifyStage !== "initial" ? (
                <>
                  <Dot />
                  <VerifyStageBadge stage={p.verifyStage} size="sm" />
                </>
              ) : stage.stage === "confirmed" && (
                <>
                  <Dot />
                  <span className="inline-flex items-center gap-0.5 text-[var(--green)]" title="Confirmed by a second-pass analysis with web search"><BadgeCheck className="w-2.5 h-2.5" /> Confirmed</span>
                </>
              )}
              {foundLabel && (
                <>
                  <Dot />
                  <span className="text-[var(--text-dim)]" title={`Found at ${fmtIst(p.foundAt!, "MMM d, HH:mm 'IST'")}`}>Found {foundLabel}</span>
                </>
              )}
            </div>
          </div>
        </Link>

        {/* Recommendation — ONE LINE */}
        {hasBet ? (
          <Link
            href={`/markets/${p.id}`}
            className="shrink-0 hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--green-soft)] border border-[var(--green)]/20 text-[var(--green)] hover:bg-[var(--green-soft)] hover:border-[var(--green)]/40 transition-colors text-xs font-medium"
            title="Click for full analysis"
          >
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            <span>
              Buy <strong className="font-semibold">{a.betSide}</strong> at <span className="mono">{bet.entryCents!.toFixed(0)}¢</span>
            </span>
            <span className="text-[var(--text-dim)]">·</span>
            <span className="mono">+{(bet.evPercent! * 100).toFixed(0)}% expected</span>
            <ArrowRight className="w-3 h-3 opacity-60 group-hover:opacity-100 transition-opacity" />
          </Link>
        ) : (
          <span className="shrink-0 hidden md:inline-block text-xs text-[var(--text-dim)] px-3 py-1.5">No clear bet right now</span>
        )}

        {/* Votes */}
        <div className="shrink-0 inline-flex items-center gap-0.5">
          <button
            onClick={() => vote(1)}
            disabled={voting}
            aria-label="Upvote"
            className={cn(
              "p-1 rounded-md transition-colors",
              myVote === 1 ? "text-[var(--green)] bg-[var(--green-soft)]" : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
            )}
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <span className="mono text-xs tabular-nums text-[var(--text)] min-w-[1.5ch] text-center">{up - down}</span>
          <button
            onClick={() => vote(-1)}
            disabled={voting}
            aria-label="Downvote"
            className={cn(
              "p-1 rounded-md transition-colors",
              myVote === -1 ? "text-[var(--red)] bg-[var(--red-soft)]" : "text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
            )}
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile recommendation row (shown when md hidden) */}
      {hasBet && (
        <Link
          href={`/markets/${p.id}`}
          className="md:hidden mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--green-soft)] border border-[var(--green)]/20 text-[var(--green)] text-xs font-medium w-full justify-between"
        >
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Buy <strong className="font-semibold">{a.betSide}</strong> at <span className="mono">{bet.entryCents!.toFixed(0)}¢</span>
          </span>
          <span className="mono">+{(bet.evPercent! * 100).toFixed(0)}%</span>
        </Link>
      )}
    </article>
  );
}

function Dot() {
  return <span className="text-[var(--text-dim)]">·</span>;
}
