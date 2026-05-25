"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronUp, ChevronDown, TrendingUp, AlertTriangle, Sparkles, Clock, BadgeCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  confidenceLabel,
  stageLabel,
  divergenceTypeLabel,
  describeBet,
  hasThreeWayStructure,
  opportunityScoreLabel,
  humanizeTimeRemaining,
  timeAgo,
} from "@/lib/explain";
import { fmtIst } from "@/lib/time";
import { ScoreBadge } from "./ScoreBadge";
import { DivergenceTooltip } from "./DivergenceTooltip";
import { VerifyStageBadge } from "./VerifyStageBadge";
import { passLabel } from "@/lib/model-label";

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
  } | null;
  votes: { up: number; down: number; mine: number };
}

export function OpportunityCard(p: CardProps) {
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
  const score = opportunityScoreLabel(a.edgeScore);
  const displayQuestion = p.eventTitle && p.groupItemTitle ? `${p.eventTitle} — ${p.groupItemTitle}` : p.question;

  async function vote(dir: 1 | -1) {
    if (!session) {
      toast.error("Sign in to vote on opportunities", { action: { label: "Sign in", onClick: () => (window.location.href = "/login") } });
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
      if (!res.ok) throw new Error("vote failed");
      const data = await res.json();
      setUp(data.up);
      setDown(data.down);
      setMyVote(data.mine);
    } catch {
      setUp(oldUp);
      setDown(oldDown);
      setMyVote(oldMine);
      toast.error("Could not save your vote");
    } finally {
      setVoting(false);
    }
  }

  // Accent border for second-opinion markets — same convention as OpportunityRow.
  const accentBorder =
    p.verifyStage === "synthesis_agreed"
      ? "border-l-2 border-l-[var(--green)]"
      : p.verifyStage === "synthesis_disagreed"
      ? "border-l-2 border-l-[var(--amber)]"
      : "";
  const foundLabel = p.foundAt ? timeAgo(p.foundAt) : null;

  return (
    <article className={cn("card p-5 hover:border-[var(--border-strong)] transition-colors group flex flex-col gap-4", accentBorder)}>
      {/* Header: image + title + score */}
      <Link href={`/markets/${p.id}`} className="flex items-start gap-3">
        {p.imageUrl && (
          <div className="shrink-0 w-12 h-12 rounded-lg overflow-hidden bg-[var(--bg-elev-2)] border border-[var(--border)]">
            <img src={p.imageUrl} alt="" className="w-full h-full object-cover" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-semibold leading-snug text-[var(--text)] group-hover:text-[var(--accent)] transition-colors line-clamp-2">{displayQuestion}</h3>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-[var(--text-muted)] flex-wrap">
            <Clock className="w-3 h-3" />
            <span>{humanizeTimeRemaining(p.endDate)}</span>
            <span aria-hidden>·</span>
            <span>${(p.liquidity / 1000).toFixed(0)}k liquidity</span>
            {(a.betSide === "YES" || a.betSide === "NO") && (
              <>
                <span aria-hidden>·</span>
                <span title="The side our analysis suggests you buy">
                  bet <strong className={a.betSide === "YES" ? "text-[var(--green)]" : "text-[var(--red)]"}>{a.betSide}</strong>
                </span>
              </>
            )}
            <span aria-hidden>·</span>
            <span title={divergenceTypeLabel(a.divergenceType).explainer}>{divergenceTypeLabel(a.divergenceType).short}</span>
            {threeWay && (
              <>
                <span aria-hidden>·</span>
                <span className="inline-flex items-center gap-0.5 text-[var(--purple)]" title="Market has a tie-breaker rule (e.g. 50-50 fallback) affecting payouts">
                  <AlertTriangle className="w-3 h-3" /> Tie-breaker
                </span>
              </>
            )}
            {foundLabel && (
              <>
                <span aria-hidden>·</span>
                <span className="text-[var(--text-dim)]" title={`Found at ${fmtIst(p.foundAt!, "MMM d, HH:mm 'IST'")}`}>Found {foundLabel}</span>
              </>
            )}
          </div>
        </div>
      </Link>

      {/* Quick facts row: score + divergence + price */}
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <ScoreBadge
          edgeScore={a.edgeScore}
          divergenceScore={a.divergenceScore}
          priceGap={a.priceGap}
          liquidity={p.liquidity}
          endDate={p.endDate}
          pass={a.pass}
          directionAgreement={a.directionAgreement}
        />
        <DivergenceTooltip divergenceScore={a.divergenceScore} divergenceType={a.divergenceType} />
        <Fact
          label="Price"
          value={
            p.yesPrice != null && p.noPrice != null
              ? `${(p.yesPrice * 100).toFixed(0)}¢ / ${(p.noPrice * 100).toFixed(0)}¢`
              : p.yesPrice != null
                ? `${(p.yesPrice * 100).toFixed(0)}¢ / ${((1 - p.yesPrice) * 100).toFixed(0)}¢`
                : "—"
          }
          help="YES / NO market price (what each share costs on Polymarket)"
        />
      </div>

      {/* The recommendation — the heart of the card */}
      {bet.entryCents != null && bet.evPercent != null && bet.evPercent > 0 ? (
        <div className="rounded-xl bg-[var(--green-soft)] border border-[var(--green)]/20 p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-[var(--green)]" />
              <span className="text-[11px] uppercase tracking-wider font-medium text-[var(--green)]">The opportunity</span>
            </div>
            <span className="text-xs font-medium text-[var(--green)] mono">+{(bet.evPercent * 100).toFixed(0)}% expected return</span>
          </div>
          <p className="text-sm leading-relaxed text-[var(--text)]">
            Buy <strong className={a.betSide === "YES" ? "text-[var(--green)]" : "text-[var(--red)]"}>{a.betSide}</strong> at{" "}
            <strong className="mono">{bet.entryCents.toFixed(0)}¢</strong> per share. If correct, each share pays out about{" "}
            <strong className="mono">{bet.expectedCents?.toFixed(0)}¢</strong>.
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[var(--bg-elev-2)] border border-[var(--border)] p-4">
          <div className="text-xs text-[var(--text-muted)]">No clear bet right now. Worth watching as prices change.</div>
        </div>
      )}

      {/* Footer: vote + model + open */}
      <div className="flex items-center justify-between pt-1 border-t border-[var(--border)] -mx-5 px-5 -mb-5 pb-3 mt-1">
        <div className="inline-flex items-center gap-0.5">
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
        <div className="inline-flex items-center gap-2">
          {p.verifyStage && p.verifyStage !== "initial" ? (
            <VerifyStageBadge stage={p.verifyStage} size="sm" />
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 mono text-xs",
                a.pass === "opus" ? "text-[var(--purple)]" : "text-[var(--text-dim)]"
              )}
              title={a.pass === "opus" ? "Confirmed by a second-pass analysis with web search" : "Initial first-pass analysis"}
            >
              {a.pass === "opus" && <BadgeCheck className="w-3 h-3" />}
              {passLabel(a.model, a.pass)}
            </span>
          )}
        </div>
        <Link href={`/markets/${p.id}`} className="text-xs text-[var(--accent)] hover:underline">
          See full analysis →
        </Link>
      </div>
    </article>
  );
}

function Fact({ label, value, accent, help }: { label: string; value: string; accent?: "green" | "red" | "amber" | "muted"; help?: string }) {
  const valueColor =
    accent === "green" ? "text-[var(--green)]"
    : accent === "red" ? "text-[var(--red)]"
    : accent === "amber" ? "text-[var(--amber)]"
    : "text-[var(--text)]";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-elev-2)] border border-[var(--border)]"
      title={help}
    >
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-dim)]">{label}</span>
      <span className={`mono text-[11px] font-medium ${valueColor}`}>{value}</span>
    </span>
  );
}
