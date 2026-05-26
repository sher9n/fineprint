"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, ChevronUp, ChevronDown, BadgeCheck, AlertCircle, Eye, Lightbulb, Calendar, Wallet, RefreshCw, ChevronDown as CaretDown, Sparkles, ShieldCheck, AlertTriangle, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BetCalculator } from "@/components/BetCalculator";
import { LogBetForm } from "@/components/LogBetForm";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/lib/utils";
import { confidenceLabel, divergenceTypeLabel, hasThreeWayStructure, describeBet, humanizeTimeRemaining, stageLabel, solveThreeWay } from "@/lib/explain";
import { fmtIst } from "@/lib/time";
import { ScenarioBreakdown } from "@/components/ScenarioBreakdown";

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
  bets: {
    id: string;
    side: string;
    priceAtBet: number;
    sizeUsd: number;
    status: string;
    pnlUsd: number | null;
    placedAt: string;
    rationale: string | null;
  }[];
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
      return res.json() as Promise<{ market: MarketDetail; votes: { up: number; down: number; mine: number } }>;
    },
    retry: false,
  });

  // Live price from Polymarket Gamma. Refetched every 60s when the page is open; server-side
  // cache is 30s so duplicate page views share one Gamma call. Falls back gracefully to the DB
  // price (m.yesPrice / m.noPrice from the last ingest) if the live fetch fails.
  const { data: liveData, refetch: refetchLive, isFetching: isFetchingLive } = useQuery({
    queryKey: ["live-price", id],
    queryFn: async () => {
      const res = await fetch(`/api/markets/${id}/live-price`);
      if (!res.ok) return null;
      return (await res.json()) as { yesPrice: number | null; noPrice: number | null; active: boolean; closed: boolean; fetchedAt: string };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  // Deep-research job status. Polled every 30s while a job is queued or in_progress; otherwise idle.
  // When status transitions to "completed", invalidate the market query so we pick up the new
  // gpt_deep + synthesis Analysis rows.
  const { data: drData, refetch: refetchDeep } = useQuery({
    queryKey: ["deep-research-job", id],
    queryFn: async () => {
      const prev = qc.getQueryData<DeepResearchStatusResponse | null>(["deep-research-job", id]);
      const res = await fetch(`/api/markets/${id}/deep-research`);
      if (res.status === 403) return null;
      if (!res.ok) return null;
      const next = (await res.json()) as DeepResearchStatusResponse;
      const justCompleted =
        next?.latestJob?.status === "completed" && prev?.latestJob?.status !== "completed";
      if (justCompleted) {
        qc.invalidateQueries({ queryKey: ["market", id] });
        toast.success("Deep-research analysis complete. New evidence is in.", { duration: 6000 });
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

  async function triggerDeepResearch() {
    if (!session?.user?.isAdmin) {
      toast.error("Admin only");
      return;
    }
    setSubmittingDeep(true);
    const toastId = toast.loading("Submitting deep-research job to OpenAI...");
    try {
      const res = await fetch(`/api/markets/${id}/deep-research`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        toast.error(body.error || "Failed to submit", { id: toastId });
        return;
      }
      toast.success("Submitted. Results in 5 to 15 minutes; this page will auto-update.", { id: toastId, duration: 6000 });
      refetchDeep();
    } catch (err) {
      toast.error(`Submit failed: ${String(err).slice(0, 200)}`, { id: toastId });
    } finally {
      setSubmittingDeep(false);
    }
  }

  async function vote(dir: 1 | -1) {
    if (!session) {
      toast.error("Sign in to vote");
      return;
    }
    if (!data) return;
    const newDir = data.votes.mine === dir ? 0 : dir;
    qc.setQueryData(["market", id], { ...data, votes: { ...data.votes, mine: newDir } });
    const res = await fetch(`/api/markets/${id}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ direction: newDir }),
    });
    if (res.ok) refetch();
  }

  async function reanalyze(pass: "haiku" | "opus") {
    if (!session?.user?.isAdmin) {
      toast.error("Admin only");
      return;
    }
    setReanalyzing(pass);
    const toastId = toast.loading(
      pass === "opus"
        ? "Running Opus verifier with web search. This takes about 30 to 60 seconds..."
        : "Re-running first-pass analysis..."
    );
    try {
      const res = await fetch(`/api/markets/${id}/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pass }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || (pass === "opus" ? "Verifier failed" : "Re-analyze failed"), { id: toastId });
      } else {
        await refetch();
        toast.success(pass === "opus" ? "Verified with Opus" : "Re-analyzed", { id: toastId });
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
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16 text-center">
          <div className="text-5xl mb-3">🔍</div>
          <h1 className="text-xl font-semibold mb-2">Opportunity not found</h1>
          <p className="text-sm text-[var(--text-muted)] mb-4">This market may have been removed from Polymarket, or the link is wrong.</p>
          <Link href="/" className="btn btn-primary">Back to opportunities</Link>
        </div>
      </AppShell>
    );
  }
  if (isLoading || !data) {
    return (
      <AppShell>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-4">
          <div className="skeleton h-8 w-32" />
          <div className="skeleton h-24" />
          <div className="skeleton h-40" />
        </div>
      </AppShell>
    );
  }

  const m = data.market;
  // Find latest analysis per pass for the CURRENT rulesHash (stale analyses are kept in history but
  // only the current-rules ones drive the UI).
  const findCurrent = (pass: string) => m.analyses.find((x) => x.pass === pass && x.rulesHash === m.rulesHash);
  const opusAnalysis = findCurrent("opus");
  const gptAnalysis = findCurrent("gpt_deep");
  const synthesisAnalysis = findCurrent("synthesis");
  // The primary analysis drives the headline recommendation, in priority order:
  // synthesis (final) > opus (verified) > gpt_deep (research only) > latest haiku/sonnet.
  const a = synthesisAnalysis ?? opusAnalysis ?? gptAnalysis ?? m.analyses[0];
  const agreement: "agree" | "disagree" | null =
    opusAnalysis && gptAnalysis
      ? opusAnalysis.edgeDirection === gptAnalysis.edgeDirection
        ? "agree"
        : "disagree"
      : null;
  const polymarketUrl = `https://polymarket.com/market/${m.slug}`;
  const displayQuestion = m.eventTitle && m.groupItemTitle ? `${m.eventTitle} — ${m.groupItemTitle}` : m.question;

  const drJob = drData?.latestJob ?? null;
  const drInflight = !!drJob && (drJob.status === "queued" || drJob.status === "in_progress");
  const drFailed = !!drJob && (drJob.status === "failed" || drJob.status === "cancelled" || drJob.status === "incomplete");
  const hasCurrentGpt = !!gptAnalysis;
  const canTriggerDeep = !!session?.user?.isAdmin && !!opusAnalysis && !hasCurrentGpt && !drInflight;

  if (!a) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
          <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-4">
            <ArrowLeft className="w-4 h-4" /> All opportunities
          </Link>
          <h1 className="text-2xl font-semibold mb-2">{displayQuestion}</h1>
          <p className="text-[var(--text-muted)]">Not yet analyzed.</p>
        </div>
      </AppShell>
    );
  }

  const conf = confidenceLabel(a.divergenceScore);
  const stage = stageLabel(a.pass);
  const divType = divergenceTypeLabel(a.divergenceType);
  const threeWay = hasThreeWayStructure(a.expectedYesPayoutCents, a.expectedNoPayoutCents, a.ruleImpliedProbability);

  // Three different prices for this market:
  //   liveYes / liveNo   - what Polymarket is showing right now (≤30s stale via server cache)
  //   m.yesPrice / m.noPrice - what our last ingest captured (typically <24h old)
  //   a.yesPriceAtAnalysis / a.noPriceAtAnalysis - what the model used to compute its verdict
  const liveYes = liveData?.yesPrice ?? null;
  const liveNo = liveData?.noPrice ?? null;
  const effectiveYes = liveYes ?? m.yesPrice;
  const effectiveNo = liveNo ?? m.noPrice;

  // The recommendation uses the live price for entry (since that's what you'd actually pay).
  // Expected payout stays from the analysis (a function of rules + true probabilities, not price).
  const bet = describeBet({
    betSide: a.betSide,
    yesPrice: effectiveYes,
    noPrice: effectiveNo,
    expectedYesPayoutCents: a.expectedYesPayoutCents,
    expectedNoPayoutCents: a.expectedNoPayoutCents,
    ruleImpliedProbability: a.ruleImpliedProbability,
  });
  const verificationSteps: string[] = a.verificationSteps ? JSON.parse(a.verificationSteps) : [];

  // Three-way scenario probabilities (computed from rule_p + expected payouts when available).
  const scenarios = threeWay
    ? solveThreeWay(a.ruleImpliedProbability, a.expectedYesPayoutCents, a.expectedNoPayoutCents)
    : null;

  // Price drift detection (live vs analysis-time, for honesty about staleness).
  const analysisEntryFraction = a.betSide === "YES" ? a.yesPriceAtAnalysis : a.noPriceAtAnalysis;
  const liveEntryCents = bet.entryCents;
  const driftCents = liveEntryCents != null && analysisEntryFraction != null
    ? liveEntryCents - analysisEntryFraction * 100
    : null;
  const driftSignificant = driftCents != null && Math.abs(driftCents) >= 1;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
          <ArrowLeft className="w-4 h-4" /> All opportunities
        </Link>

        {/* Header */}
        <div className="flex items-start gap-4">
          {m.imageUrl && (
            <div className="hidden sm:block shrink-0 w-16 h-16 rounded-xl overflow-hidden bg-[var(--bg-elev-2)] border border-[var(--border)]">
              <img src={m.imageUrl} alt="" className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight leading-tight">{displayQuestion}</h1>
            <div className="flex items-center gap-3 mt-2 text-xs sm:text-sm text-[var(--text-muted)] flex-wrap">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> {humanizeTimeRemaining(m.endDate)}
              </span>
              <span aria-hidden>·</span>
              <span className="flex items-center gap-1.5">
                <Wallet className="w-3.5 h-3.5" /> ${(m.liquidity / 1000).toFixed(0)}k available
              </span>
              <span aria-hidden>·</span>
              <a href={polymarketUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline inline-flex items-center gap-1">
                See on Polymarket <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>

        {/* The recommendation */}
        {bet.entryCents != null && bet.evPercent != null && bet.evPercent > 0 ? (
          <div className="rounded-2xl bg-[var(--green-soft)] border border-[var(--green)]/30 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <BadgeCheck className="w-5 h-5 text-[var(--green)]" />
                <span className="text-xs uppercase tracking-wider font-medium text-[var(--green)]">What to do</span>
              </div>
              <LivePriceBadge liveData={liveData} isFetching={isFetchingLive} onRefresh={() => refetchLive()} />
            </div>
            <p className="text-base sm:text-lg leading-relaxed text-[var(--text)]">
              <strong>Buy {a.betSide}</strong> at <strong className="mono">{bet.entryCents.toFixed(0)}¢</strong> per share.{" "}
              {scenarios ? (
                <>
                  Expected payout: <strong className="mono">{bet.expectedCents?.toFixed(0)}¢</strong> on average across the three outcomes below{" "}
                  <span className="text-[var(--green)] font-medium">(+{(bet.evPercent * 100).toFixed(0)}% expected return per share)</span>.
                </>
              ) : (
                <>
                  If correct, each share pays out about <strong className="mono">{bet.expectedCents?.toFixed(0)}¢</strong>{" "}
                  <span className="text-[var(--green)] font-medium">(+{(bet.evPercent * 100).toFixed(0)}% expected return)</span>.
                </>
              )}
            </p>
            {driftSignificant && analysisEntryFraction != null && (
              <div className="mt-2 text-xs text-[var(--text-muted)]">
                Price has drifted {driftCents! > 0 ? "↑" : "↓"} {Math.abs(driftCents!).toFixed(0)}¢ since the analysis ran (model used {(analysisEntryFraction * 100).toFixed(0)}¢).
              </div>
            )}
            {scenarios && (
              <ScenarioBreakdown
                betSide={a.betSide as "YES" | "NO"}
                entryCents={bet.entryCents}
                pYes={scenarios.pYes}
                pNo={scenarios.pNo}
                pFallback={scenarios.pFallback}
              />
            )}
          </div>
        ) : bet.entryCents != null && bet.evPercent != null && bet.evPercent <= 0 && analysisEntryFraction != null ? (
          // Edge has evaporated since analysis. Model said this was +EV at the analysis price, but
          // the live price has moved enough that it no longer is.
          <div className="rounded-2xl bg-[var(--amber-soft)] border border-[var(--amber)]/40 p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-[var(--amber)]" />
                <span className="text-xs uppercase tracking-wider font-medium text-[var(--amber)]">Edge has evaporated</span>
              </div>
              <LivePriceBadge liveData={liveData} isFetching={isFetchingLive} onRefresh={() => refetchLive()} />
            </div>
            <p className="text-sm sm:text-base leading-relaxed text-[var(--text)]">
              The model said buy <strong>{a.betSide}</strong> at <strong className="mono">{(analysisEntryFraction * 100).toFixed(0)}¢</strong> for an expected payout of <strong className="mono">{bet.expectedCents?.toFixed(0)}¢</strong>.{" "}
              <strong>{a.betSide}</strong> has since drifted to <strong className="mono">{bet.entryCents.toFixed(0)}¢</strong> live, so the expected return is now{" "}
              <span className="text-[var(--amber)] font-medium">{(bet.evPercent * 100).toFixed(0)}%</span>. Consider passing or waiting for the price to come back down.
            </p>
            {scenarios && (
              <ScenarioBreakdown
                betSide={a.betSide as "YES" | "NO"}
                entryCents={bet.entryCents}
                pYes={scenarios.pYes}
                pNo={scenarios.pNo}
                pFallback={scenarios.pFallback}
              />
            )}
          </div>
        ) : (
          <div className="rounded-2xl bg-[var(--bg-elev-2)] border border-[var(--border)] p-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm text-[var(--text-muted)]">
                No clear bet right now. The market price already reflects what the rules say.
              </p>
              <LivePriceBadge liveData={liveData} isFetching={isFetchingLive} onRefresh={() => refetchLive()} />
            </div>
          </div>
        )}

        {/* Agreement banner (synthesis exists) */}
        {synthesisAnalysis && agreement === "agree" && (
          <div className="rounded-xl bg-[var(--green-soft)] border border-[var(--green)]/30 p-3 flex items-center gap-2 text-sm">
            <ShieldCheck className="w-4 h-4 text-[var(--green)] shrink-0" />
            <span><strong className="text-[var(--green)]">Both models confirm</strong> the same bet side. Synthesis verdict above incorporates Opus and GPT deep-research findings.</span>
          </div>
        )}
        {synthesisAnalysis && agreement === "disagree" && (
          <div className="rounded-xl bg-[var(--amber-soft)] border border-[var(--amber)]/40 p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="w-4 h-4 text-[var(--amber)] shrink-0 mt-0.5" />
            <span>
              <strong className="text-[var(--amber)]">Models disagree:</strong> Opus says bet {opusAnalysis?.edgeDirection}, GPT deep-research says {gptAnalysis?.edgeDirection}. The synthesis above is Opus&apos;s reconciliation; see the side-by-side evidence below before betting.
            </span>
          </div>
        )}

        {/* Inflight banner */}
        {drInflight && (
          <div className="rounded-xl bg-[var(--bg-elev-2)] border border-[var(--border)] p-4 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-[var(--accent)] animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">GPT deep-research in progress</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                Submitted {fmtIst(drJob!.submittedAt, "MMM d, HH:mm 'IST'")}. Typically completes in 5 to 15 minutes. This page checks every 30 seconds and will auto-update.
              </div>
            </div>
          </div>
        )}

        {/* Failed banner */}
        {drFailed && !hasCurrentGpt && !drInflight && (
          <div className="rounded-xl bg-[var(--red-soft)] border border-[var(--red)]/30 p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[var(--red)] shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">Last GPT deep-research attempt failed</div>
              <div className="text-xs text-[var(--text-muted)] mt-0.5">
                Status: {drJob!.status}. {drJob!.errorMessage ?? "No error message."}
              </div>
            </div>
          </div>
        )}

        {/* Verify with Opus CTA (admin-only, when no opus pass exists for current rules) */}
        {session?.user?.isAdmin && !opusAnalysis && (
          <div className="rounded-xl bg-[var(--bg-elev-2)] border border-[var(--border)] p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5 min-w-0">
              <BadgeCheck className="w-5 h-5 text-[var(--text-muted)] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-medium">Initial analysis only</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  This was rated by the first-pass model. Run the Opus verifier with web search to confirm or revise. Typically under $1 of LLM budget; takes about 30 to 60 seconds.
                </div>
              </div>
            </div>
            <button
              onClick={() => reanalyze("opus")}
              disabled={!!reanalyzing}
              className="btn btn-primary btn-sm shrink-0"
            >
              {reanalyzing === "opus" ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Verifying...
                </>
              ) : (
                <>
                  <BadgeCheck className="w-4 h-4" /> Verify with Opus
                </>
              )}
            </button>
          </div>
        )}

        {/* Deep-research with GPT CTA (admin-only, when opus exists but no gpt_deep, no inflight) */}
        {canTriggerDeep && (
          <div className="rounded-xl bg-[var(--bg-elev-2)] border border-[var(--purple)]/30 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-start gap-2.5 min-w-0">
              <Sparkles className="w-5 h-5 text-[var(--purple)] shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-medium">Get a second opinion from GPT deep-research</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  Runs the OpenAI o3 deep-research model in parallel to Opus, then has Opus synthesize the two verdicts. <strong>Expensive: roughly $1 to $2 per call.</strong> Async; takes 5 to 15 minutes.
                </div>
              </div>
            </div>
            <button
              onClick={() => triggerDeepResearch()}
              disabled={submittingDeep}
              className="btn btn-sm shrink-0 border-[var(--purple)]/40 text-[var(--purple)] hover:bg-[var(--purple)]/10"
            >
              {submittingDeep ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" /> Submitting...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Deep-research with GPT
                </>
              )}
            </button>
          </div>
        )}

        {/* Bet calculator */}
        {bet.entryCents != null && (
          <BetCalculator
            betSide={a.betSide}
            yesPrice={m.yesPrice}
            noPrice={m.noPrice}
            expectedYesPayoutCents={a.expectedYesPayoutCents}
            expectedNoPayoutCents={a.expectedNoPayoutCents}
          />
        )}

        {/* Why this is an opportunity */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Panel icon={<Eye className="w-4 h-4 text-[var(--text-muted)]" />} title="What most bettors see">
            <p className="text-sm leading-relaxed">{a.vibeInterpretation}</p>
          </Panel>
          <Panel icon={<Lightbulb className="w-4 h-4 text-[var(--amber)]" />} title="What the rules actually say" tone="amber">
            <p className="text-sm leading-relaxed">{a.literalInterpretation}</p>
          </Panel>
        </div>

        {/* Tags */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn(
            "chip",
            conf.level === "very high" && "chip-red",
            conf.level === "high" && "chip-amber",
            conf.level === "medium" && "chip-accent"
          )}>
            {conf.label} mismatch
          </span>
          <span className="chip">{divType.short}</span>
          {threeWay && <span className="chip chip-purple">Tie-breaker rule</span>}
          {stage.stage === "confirmed" && <span className="chip chip-green"><BadgeCheck className="w-3 h-3" /> Confirmed with research</span>}
          {stage.stage === "initial" && <span className="chip">Initial analysis</span>}
        </div>

        {/* Reasoning */}
        <Panel title="Why this is an opportunity" tone="accent">
          <Markdown content={a.reasoning} />
        </Panel>

        {/* Source findings on the primary analysis (synthesis or opus) */}
        {a.sourceFindings && (
          <Panel icon={<AlertCircle className="w-4 h-4 text-[var(--purple)]" />} title={a.pass === "synthesis" ? "Synthesis: how the two models compared" : "What we found when we checked the facts"} tone="purple">
            <Markdown content={a.sourceFindings} />
          </Panel>
        )}

        {/* Side-by-side independent evidence (both Opus and GPT exist) */}
        {opusAnalysis && gptAnalysis && (
          <div>
            <h2 className="text-sm font-medium mb-2 text-[var(--text)]">Independent verdicts</h2>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              Each model worked on this market independently. The synthesis above is Opus reconciling these two reports.
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ModelEvidencePanel label="Opus (market-aware verifier)" analysis={opusAnalysis} accent="green" />
              <ModelEvidencePanel label="GPT deep-research (independent fact-finder)" analysis={gptAnalysis} accent="purple" />
            </div>
          </div>
        )}

        {/* Verification steps */}
        {verificationSteps.length > 0 && (
          <Panel title="Before you bet, double-check these">
            <ol className="space-y-2 text-sm">
              {verificationSteps.map((s, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-[var(--bg-elev-2)] text-[var(--text-muted)] text-[10px] font-medium flex items-center justify-center mt-0.5">{i + 1}</span>
                  <span className="leading-relaxed">{s}</span>
                </li>
              ))}
            </ol>
          </Panel>
        )}

        {/* Bet form + vote */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <LogBetForm
            marketId={m.id}
            analysisId={a.id}
            yesPrice={m.yesPrice}
            noPrice={m.noPrice}
            suggestedSide={a.betSide === "YES" || a.betSide === "NO" ? (a.betSide as "YES" | "NO") : undefined}
            onPlaced={refetch}
          />

          <div className="card p-5 space-y-4">
            <h3 className="text-sm font-medium">What do you think?</h3>
            <p className="text-xs text-[var(--text-muted)] -mt-1">Vote to help us learn which opportunities are most useful.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => vote(1)}
                className={cn(
                  "flex-1 btn justify-center",
                  data.votes.mine === 1 && "border-[var(--green)] bg-[var(--green-soft)] text-[var(--green)]"
                )}
              >
                <ChevronUp className="w-4 h-4" /> Good opportunity ({data.votes.up})
              </button>
              <button
                onClick={() => vote(-1)}
                className={cn(
                  "flex-1 btn justify-center",
                  data.votes.mine === -1 && "border-[var(--red)] bg-[var(--red-soft)] text-[var(--red)]"
                )}
              >
                <ChevronDown className="w-4 h-4" /> Not really ({data.votes.down})
              </button>
            </div>
          </div>
        </div>

        {/* Your bets on this market */}
        {m.bets && m.bets.length > 0 && (
          <Panel title="Your bets on this market">
            <div className="space-y-2">
              {m.bets.map((b) => (
                <div key={b.id} className="flex items-center justify-between text-sm py-2 border-b border-[var(--border)] last:border-b-0 last:pb-0">
                  <div className="flex items-center gap-3">
                    <span className={cn("chip", b.side === "YES" ? "chip-green" : "chip-red")}>{b.side}</span>
                    <span className="mono text-xs">${b.sizeUsd.toFixed(0)} @ {(b.priceAtBet * 100).toFixed(0)}¢</span>
                  </div>
                  <span className={cn("chip text-[10px]",
                    b.status === "won" && "chip-green",
                    b.status === "lost" && "chip-red",
                    b.status === "open" && "chip"
                  )}>{b.status}</span>
                </div>
              ))}
            </div>
          </Panel>
        )}

        {/* Rules text + technical details */}
        <div className="card p-5 space-y-3">
          <button onClick={() => setShowDetails(!showDetails)} className="w-full flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 font-medium">
              <CaretDown className={cn("w-4 h-4 transition-transform", showDetails && "-rotate-180")} />
              The full rules + technical details
            </span>
            <span className="text-xs text-[var(--text-dim)]">{showDetails ? "Hide" : "Show"}</span>
          </button>
          {showDetails && (
            <div className="space-y-4 pt-3 border-t border-[var(--border)]">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-2">Resolution rules (verbatim from Polymarket)</div>
                <pre className="text-xs leading-relaxed whitespace-pre-wrap text-[var(--text-muted)] font-sans">{m.description}</pre>
                {m.resolutionSource && (
                  <div className="text-xs text-[var(--text-dim)] mt-2">Resolution source: <span className="text-[var(--text)]">{m.resolutionSource}</span></div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <Detail label="Mismatch score" value={`${a.divergenceScore}/10`} />
                <Detail label="True odds estimate" value={a.ruleImpliedProbability != null ? `${(a.ruleImpliedProbability * 100).toFixed(0)}%` : "—"} />
                <Detail label="Expected YES payout" value={a.expectedYesPayoutCents != null ? `${a.expectedYesPayoutCents.toFixed(0)}¢` : "—"} />
                <Detail label="Expected NO payout" value={a.expectedNoPayoutCents != null ? `${a.expectedNoPayoutCents.toFixed(0)}¢` : "—"} />
                <Detail label="Opportunity score" value={a.edgeScore.toFixed(0)} />
                <Detail label="Model" value={a.model.replace("claude-", "")} />
                <Detail label="Last checked" value={fmtIst(a.createdAt, "MMM d, HH:mm 'IST'")} />
                <Detail label="Analysis cost" value={`$${a.costUsd.toFixed(3)}`} />
              </div>
              {session?.user?.isAdmin && (
                <div className="flex gap-2 pt-3 border-t border-[var(--border)]">
                  <button className="btn btn-ghost btn-sm" onClick={() => reanalyze("haiku")} disabled={!!reanalyzing}>
                    <RefreshCw className={cn("w-3 h-3", reanalyzing === "haiku" && "animate-spin")} /> Re-analyze
                  </button>
                  <button className="btn btn-sm" onClick={() => reanalyze("opus")} disabled={!!reanalyzing}>
                    <RefreshCw className={cn("w-3 h-3", reanalyzing === "opus" && "animate-spin")} /> Confirm with research
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Panel({ icon, title, tone, children }: { icon?: React.ReactNode; title: string; tone?: "amber" | "purple" | "accent"; children: React.ReactNode }) {
  return (
    <div className={cn("card p-5",
      tone === "amber" && "border-[var(--amber)]/30",
      tone === "purple" && "border-[var(--purple)]/30",
      tone === "accent" && "border-[var(--accent)]/30"
    )}>
      <div className="flex items-center gap-2 mb-2.5">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{label}</div>
      <div className="mono text-sm mt-0.5">{value}</div>
    </div>
  );
}

function LivePriceBadge({
  liveData,
  isFetching,
  onRefresh,
}: {
  liveData: { yesPrice: number | null; noPrice: number | null; fetchedAt: string } | null | undefined;
  isFetching: boolean;
  onRefresh: () => void;
}) {
  if (!liveData || (liveData.yesPrice == null && liveData.noPrice == null)) {
    return (
      <button
        onClick={onRefresh}
        disabled={isFetching}
        title="Live Polymarket price (refresh)"
        className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--text-dim)] hover:text-[var(--text-muted)] transition-colors"
      >
        <RefreshCw className={cn("w-3 h-3", isFetching && "animate-spin")} />
        {isFetching ? "Fetching…" : "Live price unavailable"}
      </button>
    );
  }
  const yesCents = liveData.yesPrice != null ? Math.round(liveData.yesPrice * 100) : null;
  const noCents = liveData.noPrice != null ? Math.round(liveData.noPrice * 100) : null;
  const ageSec = Math.max(0, Math.round((Date.now() - new Date(liveData.fetchedAt).getTime()) / 1000));
  return (
    <button
      onClick={onRefresh}
      disabled={isFetching}
      title={`Live Polymarket price. Fetched ${ageSec}s ago. Click to refresh.`}
      className="inline-flex items-center gap-1.5 text-[11px] mono text-[var(--text-muted)] hover:text-[var(--text)] transition-colors px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--bg-elev)]"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shrink-0" />
      <span>LIVE</span>
      <span className="text-[var(--text)]">{yesCents != null ? `${yesCents}¢` : "?"}</span>
      <span className="text-[var(--text-dim)]">YES</span>
      <span className="text-[var(--text-dim)]">/</span>
      <span className="text-[var(--text)]">{noCents != null ? `${noCents}¢` : "?"}</span>
      <span className="text-[var(--text-dim)]">NO</span>
      <RefreshCw className={cn("w-3 h-3 opacity-50", isFetching && "animate-spin opacity-100")} />
    </button>
  );
}

function ModelEvidencePanel({ label, analysis, accent }: { label: string; analysis: AnalysisDetail; accent: "green" | "purple" }) {
  const steps: string[] = analysis.verificationSteps ? JSON.parse(analysis.verificationSteps) : [];
  const dotColor = accent === "green" ? "bg-[var(--green)]" : "bg-[var(--purple)]";
  const borderColor = accent === "green" ? "border-[var(--green)]/25" : "border-[var(--purple)]/25";
  const directionLabel = analysis.edgeDirection === "YES" ? "Bet YES" : analysis.edgeDirection === "NO" ? "Bet NO" : "No edge";
  const directionColor = analysis.edgeDirection === "YES" ? "text-[var(--green)]" : analysis.edgeDirection === "NO" ? "text-[var(--red)]" : "text-[var(--text-muted)]";
  return (
    // min-w-0 lets the grid cell shrink when content (e.g. long URLs in GPT's citations) would
    // otherwise force the cell wider than its column. Combined with break-words on the text below,
    // this keeps the side-by-side layout intact.
    <div className={cn("card p-4 space-y-3 min-w-0 overflow-hidden", borderColor)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("w-2 h-2 rounded-full shrink-0", dotColor)} />
          <h3 className="text-sm font-medium truncate">{label}</h3>
        </div>
        <span className={cn("text-xs font-semibold mono shrink-0", directionColor)}>{directionLabel}</span>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] flex items-center gap-3 flex-wrap">
        <span>Mismatch <span className="mono text-[var(--text)]">{analysis.divergenceScore}/10</span></span>
        <span>·</span>
        <span>Model <span className="text-[var(--text)]">{analysis.model.replace(/^claude-|^gpt-|^o3-/, "")}</span></span>
        <span>·</span>
        <span>{fmtIst(analysis.createdAt, "MMM d, HH:mm 'IST'")}</span>
      </div>
      {analysis.sourceFindings && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">What it found</div>
          <Markdown content={analysis.sourceFindings} />
        </div>
      )}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] mb-1">Its reasoning</div>
        <Markdown content={analysis.reasoning} />
      </div>
      {steps.length > 0 && (
        <details>
          <summary className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] cursor-pointer hover:text-[var(--text-muted)]">Verification steps it suggested</summary>
          <ol className="mt-2 space-y-1.5 text-xs">
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
