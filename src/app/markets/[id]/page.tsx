"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ArrowLeft, ExternalLink, ThumbsUp, ThumbsDown, RefreshCw, Sparkles, AlertTriangle, Loader2, AlertCircle, ChevronDown, Globe,
} from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PotentialReturn } from "@/components/PotentialReturn";
import { Markdown } from "@/components/Markdown";
import { BookmarkButton } from "@/components/BookmarkButton";
import { TrustBadge } from "@/components/TrustBadge";
import { MismatchStat, ScoreStat } from "@/components/PickStats";
import { FindingsView } from "@/components/FindingsView";
import { ScenarioBreakdown } from "@/components/ScenarioBreakdown";
import { cn } from "@/lib/utils";
import {
  describeBet, impliedBetSide, resolutionTimeline, hasThreeWayStructure, solveThreeWay,
  pickKind, upsidePercent, trustLabel,
} from "@/lib/explain";
import { fmtIst, fmtIstShort } from "@/lib/time";
import { marketDisplayUrl } from "@/lib/polymarket";

interface AnalysisDetail {
  id: string;
  pass: string;
  model: string;
  rulesHash: string;
  divergenceScore: number;
  divergenceType: string;
  edgeDirection: string;
  betSide: string;
  edgeScore: number;
  ruleImpliedProbability: number | null;
  expectedYesPayoutCents: number | null;
  expectedNoPayoutCents: number | null;
  priceGap: number | null;
  directionAgreement: boolean;
  yesPriceAtAnalysis: number | null;
  noPriceAtAnalysis: number | null;
  vibeInterpretation: string;
  literalInterpretation: string;
  reasoning: string;
  sourceFindings: string | null;
  verificationSteps: string | null;
  costUsd: number;
  createdAt: string;
}

interface DeepResearchJobStatus {
  id: string;
  openaiResponseId: string;
  model: string;
  status: string;
  costUsd: number;
  errorMessage: string | null;
  submittedAt: string;
  lastPolledAt: string | null;
  completedAt: string | null;
}

interface DeepResearchStatusResponse {
  market: { id: string; rulesHash: string };
  latestJob: DeepResearchJobStatus | null;
  hasCompletedForCurrentRules: boolean;
}

interface MarketDetail {
  id: string;
  slug: string;
  question: string;
  description: string;
  resolutionSource: string | null;
  endDate: string | null;
  liquidity: number;
  volume: number;
  yesPrice: number | null;
  noPrice: number | null;
  imageUrl: string | null;
  eventTitle: string | null;
  eventSlug: string | null;
  groupItemTitle: string | null;
  rulesHash: string;
  analyses: AnalysisDetail[];
}

export default function MarketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const qc = useQueryClient();
  const { data: session } = useSession();
  const [showDetails, setShowDetails] = useState(false);
  const [reanalyzing, setReanalyzing] = useState<"haiku" | "opus" | null>(null);
  const [submittingDeep, setSubmittingDeep] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["market", id],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${id}`);
      if (!res.ok) throw new Error("not found");
      return res.json() as Promise<{ market: MarketDetail; votes: { up: number; down: number; mine: number }; bookmarked: boolean }>;
    },
    retry: false,
  });

  const { data: liveData, refetch: refetchLive, isFetching: isFetchingLive } = useQuery({
    queryKey: ["live-price", id],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${id}/live-price`);
      if (!res.ok) return null;
      return (await res.json()) as {
        yesPrice: number | null; noPrice: number | null; yesAsk: number | null; noAsk: number | null;
        spread: number | null; active: boolean; closed: boolean; fetchedAt: string;
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    refetchOnMount: "always",
    retry: 1,
  });

  const { data: drData, refetch: refetchDeep } = useQuery({
    queryKey: ["deep-research-job", id],
    queryFn: async () => {
      const prev = qc.getQueryData<DeepResearchStatusResponse | null>(["deep-research-job", id]);
      const res = await fetch(`/api/markets/${id}/deep-research`);
      if (res.status === 403) return null;
      if (!res.ok) return null;
      const next = (await res.json()) as DeepResearchStatusResponse;
      const justCompleted = next?.latestJob?.status === "completed" && prev?.latestJob?.status !== "completed";
      if (justCompleted) {
        qc.invalidateQueries({ queryKey: ["market", id] });
        toast.success("Deep research finished. New evidence is in.", { duration: 6000 });
      }
      return next;
    },
    enabled: !!session?.user?.isAdmin,
    refetchInterval: (q) => {
      const j = (q.state.data as DeepResearchStatusResponse | undefined)?.latestJob;
      if (j && (j.status === "queued" || j.status === "in_progress")) return 30_000;
      return false;
    },
  });

  async function triggerDeepResearch(force = false) {
    if (!session?.user?.isAdmin) { toast.error("Admin only"); return; }
    setSubmittingDeep(true);
    const toastId = toast.loading(force ? "Re-submitting deep research..." : "Submitting deep research to OpenAI...");
    try {
      const url = force ? `/api/markets/${id}/deep-research?force=1` : `/api/markets/${id}/deep-research`;
      const res = await fetch(url, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) { toast.error(body.error || "Failed to submit", { id: toastId }); return; }
      toast.success("Submitted. Results in 5 to 15 minutes; this page will auto-update.", { id: toastId, duration: 6000 });
      refetchDeep();
    } catch (err) {
      toast.error(`Submit failed: ${String(err).slice(0, 200)}`, { id: toastId });
    } finally {
      setSubmittingDeep(false);
    }
  }

  async function vote(dir: 1 | -1) {
    if (!session) { toast.error("Sign in to vote"); return; }
    if (!data) return;
    const newDir = data.votes.mine === dir ? 0 : dir;
    qc.setQueryData(["market", id], { ...data, votes: { ...data.votes, mine: newDir } });
    const res = await fetch(`/api/markets/${id}/vote`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ direction: newDir }),
    });
    if (res.ok) refetch();
  }

  async function reanalyze(pass: "haiku" | "opus") {
    if (!session?.user?.isAdmin) { toast.error("Admin only"); return; }
    setReanalyzing(pass);
    const toastId = toast.loading(pass === "opus" ? "Reviewing with web search. About 30 to 60 seconds..." : "Re-running first-pass...");
    try {
      const res = await fetch(`/api/markets/${id}/analyze`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pass }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || "Failed", { id: toastId });
      } else {
        await refetch();
        toast.success(pass === "opus" ? "Reviewed" : "Re-analyzed", { id: toastId });
      }
    } catch (err) {
      toast.error(`Request failed: ${String(err).slice(0, 200)}`, { id: toastId });
    } finally {
      setReanalyzing(null);
    }
  }

  if (isError) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-20 text-center">
          <h1 className="font-display text-[28px] sm:text-[34px] leading-[1.1] tight mb-3">We couldn&apos;t find that pick</h1>
          <p className="text-[15px] text-[var(--text-muted)] mb-6 max-w-md mx-auto">It may have been removed from Polymarket, or the link is wrong.</p>
          <Link href="/" className="btn btn-primary">Back to today&apos;s picks</Link>
        </div>
      </AppShell>
    );
  }
  if (isLoading || !data) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
          <div className="skeleton h-6 w-28" />
          <div className="skeleton h-28 rounded-[var(--radius-lg)]" />
          <div className="skeleton h-44 rounded-[var(--radius-lg)]" />
        </div>
      </AppShell>
    );
  }

  const m = data.market;
  const findCurrent = (pass: string) => m.analyses.find((x) => x.pass === pass && x.rulesHash === m.rulesHash);
  const opusAnalysis = findCurrent("opus");
  const gptAnalysis = findCurrent("gpt_deep");
  const synthesisAnalysis = findCurrent("synthesis");
  const currentAnalyses = m.analyses.filter((x) => x.rulesHash === m.rulesHash);
  const a = currentAnalyses[0] ?? m.analyses[0];
  // When this opportunity was discovered: earliest escalated/verified pass (mirrors the feed's foundAt).
  const discoveredAt = m.analyses.reduce<string | null>(
    (min, x) =>
      ["opus", "gpt_deep", "synthesis", "obvious"].includes(x.pass) && (!min || x.createdAt < min) ? x.createdAt : min,
    null,
  );

  const opusSide = opusAnalysis ? impliedBetSide(opusAnalysis, opusAnalysis.yesPriceAtAnalysis ?? m.yesPrice) : "NONE";
  const gptSide = gptAnalysis ? impliedBetSide(gptAnalysis, gptAnalysis.yesPriceAtAnalysis ?? m.yesPrice) : "NONE";
  const agreement: "agree" | "disagree" | null =
    opusAnalysis && gptAnalysis
      ? opusSide !== "NONE" && gptSide !== "NONE" && opusSide === gptSide ? "agree"
        : opusSide === gptSide ? null : "disagree"
      : null;
  const polymarketUrl = marketDisplayUrl(m);
  const displayQuestion = m.eventTitle && m.groupItemTitle ? `${m.eventTitle}: ${m.groupItemTitle}` : m.question;

  const drJob = drData?.latestJob ?? null;
  const drInflight = !!drJob && (drJob.status === "queued" || drJob.status === "in_progress");
  const drFailed = !!drJob && (drJob.status === "failed" || drJob.status === "cancelled" || drJob.status === "incomplete");
  const hasCurrentGpt = !!gptAnalysis;

  if (!a) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
          <BackLink />
          <h1 className="font-display text-[28px] sm:text-[34px] leading-[1.1] tight mt-6 mb-3">{displayQuestion}</h1>
          <p className="text-[var(--text-muted)]">Not analyzed yet.</p>
        </div>
      </AppShell>
    );
  }

  const threeWay = hasThreeWayStructure(a.expectedYesPayoutCents, a.expectedNoPayoutCents, a.ruleImpliedProbability);
  const kind = pickKind(a.pass, a.divergenceType);
  const trust = trustLabel(synthesisAnalysis ? (agreement === "agree" ? "synthesis_agreed" : agreement === "disagree" ? "synthesis_disagreed" : "opus_and_gpt") : gptAnalysis ? "gpt_only" : opusAnalysis ? "opus_only" : "initial");

  // Prices: prefer live ask (what you'd actually pay), fall back to DB midpoints.
  const liveYes = liveData?.yesAsk ?? liveData?.yesPrice ?? null;
  const liveNo = liveData?.noAsk ?? liveData?.noPrice ?? null;
  const effectiveYes = liveYes ?? m.yesPrice;
  const effectiveNo = liveNo ?? m.noPrice;

  const bet = describeBet({
    betSide: a.betSide, yesPrice: effectiveYes, noPrice: effectiveNo,
    expectedYesPayoutCents: a.expectedYesPayoutCents, expectedNoPayoutCents: a.expectedNoPayoutCents,
    ruleImpliedProbability: a.ruleImpliedProbability,
  });
  const verificationSteps: string[] = a.verificationSteps ? JSON.parse(a.verificationSteps) : [];
  const scenarios = threeWay ? solveThreeWay(a.ruleImpliedProbability, a.expectedYesPayoutCents, a.expectedNoPayoutCents) : null;

  const analysisEntryFraction = a.betSide === "YES" ? a.yesPriceAtAnalysis : a.noPriceAtAnalysis;
  const liveEntryCents = bet.entryCents;
  const driftCents = liveEntryCents != null && analysisEntryFraction != null ? liveEntryCents - analysisEntryFraction * 100 : null;
  const driftSignificant = driftCents != null && Math.abs(driftCents) >= 1;

  const side = a.betSide === "YES" ? "YES" : a.betSide === "NO" ? "NO" : null;
  const isYes = side === "YES";
  const upside = upsidePercent(bet.entryCents);
  const goodBet = bet.entryCents != null && bet.evPercent != null && bet.evPercent > 0 && side;
  const evaporated = bet.entryCents != null && bet.evPercent != null && bet.evPercent <= 0 && analysisEntryFraction != null && side;

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-9 space-y-7">
        <BackLink />

        {/* Header */}
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <span className="text-[13px] font-semibold text-[var(--text-muted)]">{kind.label}</span>
            <TrustBadge stage={synthesisAnalysis ? (agreement === "agree" ? "synthesis_agreed" : agreement === "disagree" ? "synthesis_disagreed" : "opus_and_gpt") : gptAnalysis ? "gpt_only" : opusAnalysis ? "opus_only" : "initial"} size="sm" />
          </div>
          <h1 className="font-display text-[27px] sm:text-[36px] leading-[1.12] tight text-[var(--text)]">{displayQuestion}</h1>
          <div className="flex items-center gap-3 mt-3.5 text-[14px] text-[var(--text-muted)] flex-wrap">
            <span>{resolutionTimeline(m.endDate, m.groupItemTitle)}</span>
            <span className="text-[var(--text-dim)]">&middot;</span>
            <span><span className="mono">${(m.liquidity / 1000).toFixed(0)}k</span> in play</span>
            {discoveredAt && (
              <>
                <span className="text-[var(--text-dim)]">&middot;</span>
                <span>Found {fmtIstShort(discoveredAt)}</span>
              </>
            )}
            <span className="text-[var(--text-dim)]">&middot;</span>
            <a href={polymarketUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">
              View on Polymarket <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <span className="ml-auto"><BookmarkButton marketId={id} initial={!!data.bookmarked} variant="labeled" /></span>
          </div>
        </div>

        {/* The bet */}
        {goodBet ? (
          <div className={cn("rounded-[var(--radius-xl)] p-6 sm:p-8", isYes ? "bg-[var(--green-soft)]" : "bg-[var(--red-soft)]")}>
            <div className="flex items-center justify-between gap-2 mb-4">
              <span className="text-[12px] uppercase tracking-[0.12em] font-bold" style={{ color: isYes ? "var(--green)" : "var(--red)" }}>What to do</span>
              <LivePriceBadge liveData={liveData} isFetching={isFetchingLive} onRefresh={() => refetchLive()} />
            </div>
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="font-display text-[30px] sm:text-[40px] leading-none tight text-[var(--text)]">
                Buy <span style={{ color: isYes ? "var(--green)" : "var(--red)" }}>{side}</span> at <span className="mono">{bet.entryCents!.toFixed(0)}c</span>
              </span>
              {upside != null && (
                <span className="ml-auto inline-flex flex-col items-end">
                  <span className="mono text-[24px] sm:text-[28px] font-bold leading-none" style={{ color: isYes ? "var(--green)" : "var(--red)" }}>+{upside}%</span>
                  <span className="text-[12px] text-[var(--text-muted)]">if it works out</span>
                </span>
              )}
            </div>
            <p className="text-[15px] sm:text-[16px] leading-relaxed text-[var(--text-muted)] mt-4">
              {scenarios ? (
                <>A share costs <span className="mono text-[var(--text)]">{bet.entryCents!.toFixed(0)}c</span> and pays about <span className="mono text-[var(--text)]">{bet.expectedCents?.toFixed(0)}c</span> on average across the three outcomes below. The price hasn&apos;t fully priced that in.</>
              ) : (
                <>A share costs <span className="mono text-[var(--text)]">{bet.entryCents!.toFixed(0)}c</span> and pays <span className="mono text-[var(--text)]">$1.00</span> if this happens. We think the real chance is higher than the price, and that gap is the edge.</>
              )}
            </p>
            {driftSignificant && analysisEntryFraction != null && (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                Heads up: the price has moved {driftCents! > 0 ? "up" : "down"} {Math.abs(driftCents!).toFixed(0)}c since we looked (we saw {(analysisEntryFraction * 100).toFixed(0)}c).
              </p>
            )}
            {scenarios && (
              <ScenarioBreakdown betSide={side as "YES" | "NO"} entryCents={bet.entryCents!} pYes={scenarios.pYes} pNo={scenarios.pNo} pFallback={scenarios.pFallback} />
            )}
            <PotentialReturn betSide={a.betSide} yesPrice={effectiveYes} noPrice={effectiveNo} tone={isYes ? "green" : "red"} />
            <div className="mt-4">
              <a href={polymarketUrl} target="_blank" rel="noreferrer" className={cn("btn btn-lg btn-block", isYes ? "btn-green" : "btn-red")}>
                Place this bet on Polymarket <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        ) : evaporated ? (
          <div className="rounded-[var(--radius-xl)] bg-[var(--amber-soft)] p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-[var(--amber)]"><AlertTriangle className="w-4 h-4" /> The edge is gone for now</span>
              <LivePriceBadge liveData={liveData} isFetching={isFetchingLive} onRefresh={() => refetchLive()} />
            </div>
            <p className="text-[15px] leading-relaxed text-[var(--text)]">
              We liked <strong>{side}</strong> at <strong className="mono">{(analysisEntryFraction! * 100).toFixed(0)}c</strong>, but it has since risen to <strong className="mono">{bet.entryCents!.toFixed(0)}c</strong> live. At that price the expected return is no longer positive. Worth waiting for the price to come back down.
            </p>
            {scenarios && (
              <ScenarioBreakdown betSide={side as "YES" | "NO"} entryCents={bet.entryCents!} pYes={scenarios.pYes} pNo={scenarios.pNo} pFallback={scenarios.pFallback} />
            )}
          </div>
        ) : (
          <div className="rounded-[var(--radius-xl)] bg-[var(--bg-sunken)] border border-[var(--border)] p-6">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-display text-[20px] text-[var(--text)]">No clear bet right now</div>
                <p className="text-[15px] text-[var(--text-muted)] mt-1.5">The price already matches what the rules say. There&apos;s a real wrinkle worth understanding below, but no obvious edge today.</p>
              </div>
              <LivePriceBadge liveData={liveData} isFetching={isFetchingLive} onRefresh={() => refetchLive()} />
            </div>
          </div>
        )}

        {/* In brief: the gist + strength/score */}
        <div className="card card-pad">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3.5">
            <h2 className="font-display text-[19px] text-[var(--text)]">In brief</h2>
            <div className="flex items-center gap-2.5">
              <MismatchStat score={a.divergenceScore} isMispricing={a.pass === "obvious"} vibe={a.vibeInterpretation} literal={a.literalInterpretation} />
              <ScoreStat edgeScore={a.edgeScore} divergenceScore={a.divergenceScore} priceGap={a.priceGap} liquidity={m.liquidity} endDate={m.endDate} pass={a.pass} directionAgreement={a.directionAgreement} />
            </div>
          </div>
          <ul className="space-y-2.5 text-[15px] leading-relaxed">
            <li className="flex gap-2.5">
              <span className="text-[var(--accent)] shrink-0 mt-0.5">&#9656;</span>
              <span className="text-[var(--text)] font-medium">
                {goodBet ? <>Buy {side} at <span className="mono">{bet.entryCents!.toFixed(0)}c</span>{upside != null ? <> for about <span className="mono">+{upside}%</span> if it works out</> : null}.</> : evaporated ? <>We liked {side}, but the edge is gone at the current price.</> : <>No clear bet right now; the price already matches the rules.</>}
              </span>
            </li>
            <li className="flex gap-2.5">
              <span className="text-[var(--amber)] shrink-0 mt-0.5">&#9656;</span>
              <span className="text-[var(--text)]">{a.literalInterpretation}</span>
            </li>
          </ul>
          <div className="text-[13px] text-[var(--text-dim)] mt-3.5 pt-3.5 border-t border-[var(--border)]">{trust.detail}</div>
        </div>
        {agreement === "disagree" && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--amber-soft)] p-4 flex items-start gap-2.5 text-[14px]">
            <AlertTriangle className="w-4 h-4 text-[var(--amber)] shrink-0 mt-0.5" />
            <span className="text-[var(--text)]">
              Our two reviews disagree: one leans {opusSide === "NONE" ? "no bet" : `buy ${opusSide}`}, the other leans {gptSide === "NONE" ? "no bet" : `buy ${gptSide}`}. The recommendation above is our best reconciliation. Read both reviews below before you decide.
            </span>
          </div>
        )}

        {/* Admin: deep-research progress / actions */}
        {drInflight && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--bg-elev-2)] border border-[var(--border)] p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-[var(--accent)] animate-spin shrink-0" />
            <div className="text-[14px]"><span className="font-medium">Deep research in progress.</span> <span className="text-[var(--text-muted)]">Submitted {fmtIst(drJob!.submittedAt, "MMM d, HH:mm 'IST'")}. This page updates automatically.</span></div>
          </div>
        )}
        {drFailed && !hasCurrentGpt && !drInflight && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--red-soft)] p-4 flex items-start gap-2.5 text-[14px]">
            <AlertCircle className="w-5 h-5 text-[var(--red)] shrink-0 mt-0.5" />
            <div><span className="font-medium">Last deep-research attempt failed.</span> <span className="text-[var(--text-muted)]">{drJob!.errorMessage ?? drJob!.status}</span></div>
          </div>
        )}
        {session?.user?.isAdmin && (
          <div className="rounded-[var(--radius-lg)] bg-[var(--bg-elev-2)] border border-[var(--border)] p-4">
            <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-dim)] mb-3">Admin reviews</div>
            <div className="flex flex-wrap gap-2.5">
              <button onClick={() => reanalyze("haiku")} disabled={!!reanalyzing} className="btn btn-sm">
                {reanalyzing === "haiku"
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Re-running...</>
                  : <><RefreshCw className="w-4 h-4" /> Re-run first pass</>}
              </button>
              <button onClick={() => reanalyze("opus")} disabled={!!reanalyzing} className="btn btn-sm">
                {reanalyzing === "opus"
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Reviewing...</>
                  : <><Globe className="w-4 h-4" /> {opusAnalysis ? "Review with web search again" : "Review with web search"}</>}
              </button>
              <button onClick={() => triggerDeepResearch(hasCurrentGpt)} disabled={submittingDeep || drInflight} className="btn btn-sm">
                {drInflight
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Deep research running...</>
                  : submittingDeep
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Submitting...</>
                  : <><Sparkles className="w-4 h-4" /> {hasCurrentGpt ? "Review with deep research again" : "Review with deep research"}</>}
              </button>
            </div>
            <div className="text-[12px] text-[var(--text-dim)] mt-2.5 leading-relaxed">
              Web search re-runs the Opus verifier (about 30 to 60 seconds). Deep research runs GPT and takes a few minutes (about $1 to $2).
            </div>
          </div>
        )}

        {/* Why the crowd is wrong */}
        <Section title="Why we think the crowd is wrong">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="card card-pad">
              <div className="text-[12px] font-bold uppercase tracking-[0.1em] text-[var(--text-muted)] mb-2.5">What people assume</div>
              <p className="text-[15px] leading-relaxed text-[var(--text)]">{a.vibeInterpretation}</p>
            </div>
            <div className="card card-pad" style={{ background: "var(--amber-soft)", borderColor: "transparent" }}>
              <div className="text-[12px] font-bold uppercase tracking-[0.1em] mb-2.5" style={{ color: "var(--amber)" }}>What actually has to happen</div>
              <p className="text-[15px] leading-relaxed text-[var(--text)]">{a.literalInterpretation}</p>
            </div>
          </div>
        </Section>

        {/* Reasoning */}
        <Section title="The full reasoning">
          <div className="card card-pad"><Markdown content={a.reasoning} /></div>
        </Section>

        {/* What we checked */}
        {a.sourceFindings && (
          <Section title={a.pass === "synthesis" ? "How the two reviews compared" : "What we found when we checked"}>
            <div className="card card-pad"><FindingsView content={a.sourceFindings} /></div>
          </Section>
        )}

        {/* Independent verdicts */}
        {opusAnalysis && gptAnalysis && (
          <Section title="The two independent reviews" subtitle="Each reviewed this on its own. The recommendation above is our reconciliation of the two.">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ModelEvidencePanel label="Market-aware review" analysis={opusAnalysis} accent="green" />
              <ModelEvidencePanel label="Independent fact-check" analysis={gptAnalysis} accent="purple" />
            </div>
          </Section>
        )}

        {/* Before you bet */}
        {verificationSteps.length > 0 && (
          <Section title="Before you bet, double-check these">
            <ol className="card card-pad space-y-3">
              {verificationSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-[15px]">
                  <span className="shrink-0 w-6 h-6 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] text-[12px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="leading-relaxed text-[var(--text)]">{s}</span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {/* Was this useful */}
        <div className="card card-pad flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="font-display text-[18px] text-[var(--text)]">Was this pick useful?</div>
            <p className="text-[14px] text-[var(--text-muted)] mt-0.5">Your feedback helps us surface better picks.</p>
          </div>
          <div className="flex items-center gap-2.5">
            <button onClick={() => vote(1)} className={cn("btn", data.votes.mine === 1 && "btn-green")}>
              <ThumbsUp className="w-4 h-4" /> Yes ({data.votes.up})
            </button>
            <button onClick={() => vote(-1)} className={cn("btn", data.votes.mine === -1 && "btn-red")}>
              <ThumbsDown className="w-4 h-4" /> Not really ({data.votes.down})
            </button>
          </div>
        </div>

        {/* Details accordion */}
        <div className="card card-pad">
          <button onClick={() => setShowDetails(!showDetails)} className="w-full flex items-center justify-between text-[15px] font-semibold">
            <span className="flex items-center gap-2">
              <ChevronDown className={cn("w-4 h-4 transition-transform", showDetails && "rotate-180")} />
              The full rules and the technical details
            </span>
          </button>
          {showDetails && (
            <div className="space-y-5 pt-4 mt-4 border-t border-[var(--border)]">
              <div>
                <div className="text-[12px] uppercase tracking-wider text-[var(--text-dim)] mb-2">Resolution rules (word for word from Polymarket)</div>
                <pre className="text-[13px] leading-relaxed whitespace-pre-wrap text-[var(--text-muted)] font-sans">{m.description}</pre>
                {m.resolutionSource && <div className="text-[13px] text-[var(--text-dim)] mt-2">Resolution source: <span className="text-[var(--text)]">{m.resolutionSource}</span></div>}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-[13px]">
                <Detail label="Strength score" value={`${a.divergenceScore}/10`} />
                <Detail label="Our odds estimate" value={a.ruleImpliedProbability != null ? `${(a.ruleImpliedProbability * 100).toFixed(0)}%` : "-"} />
                <Detail label="Expected YES payout" value={a.expectedYesPayoutCents != null ? `${a.expectedYesPayoutCents.toFixed(0)}c` : "-"} />
                <Detail label="Expected NO payout" value={a.expectedNoPayoutCents != null ? `${a.expectedNoPayoutCents.toFixed(0)}c` : "-"} />
                <Detail label="Opportunity score" value={`${Math.round(a.edgeScore / 10)}/10`} />
                <Detail label="Reviewed by" value={a.model.replace(/^claude-|^o3-/, "")} />
                <Detail label="Last checked" value={fmtIst(a.createdAt, "MMM d, HH:mm 'IST'")} />
                <Detail label="Analysis cost" value={`$${a.costUsd.toFixed(3)}`} />
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function BackLink() {
  return (
    <Link href="/" className="inline-flex items-center gap-1.5 text-[14px] text-[var(--text-muted)] hover:text-[var(--text)]">
      <ArrowLeft className="w-4 h-4" /> All picks
    </Link>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="font-display text-[20px] sm:text-[22px] text-[var(--text)] mb-1">{title}</h2>
      {subtitle && <p className="text-[14px] text-[var(--text-muted)] mb-3.5">{subtitle}</p>}
      {!subtitle && <div className="mb-3.5" />}
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)]">{label}</div>
      <div className="mono text-[14px] mt-0.5 text-[var(--text)]">{value}</div>
    </div>
  );
}

function LivePriceBadge({ liveData, isFetching, onRefresh }: {
  liveData: { yesPrice: number | null; noPrice: number | null; yesAsk?: number | null; noAsk?: number | null; fetchedAt: string } | null | undefined;
  isFetching: boolean; onRefresh: () => void;
}) {
  const yesFraction = liveData?.yesAsk ?? liveData?.yesPrice ?? null;
  const noFraction = liveData?.noAsk ?? liveData?.noPrice ?? null;
  if (!liveData || (yesFraction == null && noFraction == null)) {
    return (
      <button onClick={onRefresh} disabled={isFetching} className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] text-[var(--text-dim)] hover:text-[var(--text-muted)] hover:border-[var(--border-strong)] transition-colors">
        <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} /> {isFetching ? "Checking price..." : "Check live price"}
      </button>
    );
  }
  const yesCents = yesFraction != null ? (yesFraction * 100).toFixed(0) : "?";
  const noCents = noFraction != null ? (noFraction * 100).toFixed(0) : "?";
  return (
    <button
      onClick={onRefresh}
      disabled={isFetching}
      title={`Live Polymarket price — YES ${yesCents}c, NO ${noCents}c. Click to refresh.`}
      className="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap px-3 py-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-elev)] hover:border-[var(--border-strong)] transition-colors"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shrink-0 pulse-dot" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-dim)]">Live</span>
      <span className="mono text-[12px] leading-none text-[var(--text)]">
        {yesCents}c<span className="text-[var(--text-dim)] mx-1">/</span>{noCents}c
      </span>
      <RefreshCw className={cn("w-3 h-3 text-[var(--text-dim)] transition-colors group-hover:text-[var(--text-muted)]", isFetching && "animate-spin text-[var(--accent)]")} />
    </button>
  );
}

function ModelEvidencePanel({ label, analysis, accent }: { label: string; analysis: AnalysisDetail; accent: "green" | "purple" }) {
  const steps: string[] = analysis.verificationSteps ? JSON.parse(analysis.verificationSteps) : [];
  const dotColor = accent === "green" ? "bg-[var(--green)]" : "bg-[var(--purple)]";
  const dir = analysis.edgeDirection === "YES" ? "Leans YES" : analysis.edgeDirection === "NO" ? "Leans NO" : "No edge";
  const dirColor = analysis.edgeDirection === "YES" ? "text-[var(--green)]" : analysis.edgeDirection === "NO" ? "text-[var(--red)]" : "text-[var(--text-muted)]";
  return (
    <div className="card card-pad space-y-3 min-w-0 overflow-hidden">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
            <h3 className="text-[15px] font-semibold truncate">{label}</h3>
          </div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1 ml-4">Reviewed {fmtIstShort(analysis.createdAt)}</div>
        </div>
        <span className={cn("text-[13px] font-bold mono shrink-0 mt-0.5", dirColor)}>{dir}</span>
      </div>
      {analysis.sourceFindings && (
        <div>
          <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-1">What it found</div>
          <FindingsView content={analysis.sourceFindings} />
        </div>
      )}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] mb-1">Its reasoning</div>
        <Markdown content={analysis.reasoning} />
      </div>
      {steps.length > 0 && (
        <details>
          <summary className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] cursor-pointer hover:text-[var(--text-muted)]">Checks it suggested</summary>
          <ol className="mt-2 space-y-1.5 text-[13px]">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-[var(--text-dim)] mono shrink-0">{i + 1}.</span>
                <span className="leading-relaxed text-[var(--text-muted)] break-words [overflow-wrap:anywhere]">{s}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
