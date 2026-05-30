"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, SlidersHorizontal, X, Check } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { OpportunityCard } from "@/components/OpportunityCard";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { describeBet, upsidePercent } from "@/lib/explain";
import { cn } from "@/lib/utils";

type Market = Parameters<typeof OpportunityCard>[0];
type Sort = "score" | "mismatch" | "upside" | "votes" | "soon" | "new";
type Kind = "" | "rule" | "news";
type Verify = "" | "one" | "both" | "agree" | "disagree" | "first";

const SORTS: { id: Sort; label: string }[] = [
  { id: "score", label: "Best score" },
  { id: "mismatch", label: "Biggest mismatch" },
  { id: "upside", label: "Best upside" },
  { id: "votes", label: "Most upvoted" },
  { id: "soon", label: "Ending soon" },
  { id: "new", label: "Newest" },
];

// Maps the friendly verification choice to the API's verifyStage value. The synthesis variants
// score low by design (the synthesis pass lowers divergence when models disagree), so we ease the
// score/strength floors when one of them is selected, or those picks would never surface.
const VERIFY_API: Record<Verify, string> = {
  "": "", one: "opus_only", both: "synthesis", agree: "synthesis_agreed", disagree: "synthesis_disagreed", first: "initial",
};
const VERIFY_LABELS: { id: Verify; label: string }[] = [
  { id: "", label: "Any" },
  { id: "first", label: "First look only" },
  { id: "one", label: "Checked by one model" },
  { id: "both", label: "Checked by both models" },
  { id: "agree", label: "Both agree" },
  { id: "disagree", label: "Both disagree" },
];
const DIV_LEVELS = [0, 2, 4, 6, 8];
const SCORE_LEVELS = [0, 2, 4, 6, 8]; // shown 0-10; mapped to the underlying 0-100 score below
const DEFAULT_DIV = 4;
const DEFAULT_SCORE = 2;
// The opportunity score is stored 0-100; show it 0-10. A chip of N maps to "rounds to N or higher",
// i.e. underlying score >= N*10 - 5, so the chips line up exactly with the X/10 shown on cards.
const scoreToApi = (v: number) => (v <= 0 ? 0 : v * 10 - 5);

async function fetchCat(cat: string, q: string, params: Record<string, string | number>): Promise<Market[]> {
  const sp = new URLSearchParams({ category: cat, limit: "100", ...(q ? { q } : {}) });
  for (const [k, v] of Object.entries(params)) if (v !== "" && v != null) sp.set(k, String(v));
  const res = await fetch(`/api/markets?${sp}`);
  if (!res.ok) throw new Error("fetch failed");
  return ((await res.json()) as { markets: Market[] }).markets;
}

// One unified feed merging both pipelines. Verification is fineprint-specific, so it only scopes
// the opportunities call and (when set) hides mispricings.
async function fetchMerged(q: string, kind: Kind, minDiv: number, minScore: number, verify: Verify): Promise<Market[]> {
  const relax = verify === "both" || verify === "agree" || verify === "disagree";
  const fetchOpp = kind !== "news";
  const fetchMisp = kind !== "rule" && verify === "";
  const reqs: Promise<Market[]>[] = [];
  if (fetchOpp) reqs.push(fetchCat("opportunities", q, { minScore: relax ? 0 : scoreToApi(minScore), minDivergence: relax ? 0 : minDiv, verifyStage: VERIFY_API[verify] }));
  if (fetchMisp) reqs.push(fetchCat("mispricings", q, { minScore: scoreToApi(minScore), minDivergence: minDiv }));
  const lists = await Promise.all(reqs);
  const byId = new Map<string, Market>();
  for (const m of lists.flat()) {
    const prev = byId.get(m.id);
    if (!prev || (m.analysis?.edgeScore ?? 0) > (prev.analysis?.edgeScore ?? 0)) byId.set(m.id, m);
  }
  return [...byId.values()];
}

function entryUpside(m: Market): number {
  if (!m.analysis) return -1;
  const bet = describeBet({
    betSide: m.analysis.betSide, yesPrice: m.yesPrice, noPrice: m.noPrice,
    expectedYesPayoutCents: m.analysis.expectedYesPayoutCents, expectedNoPayoutCents: m.analysis.expectedNoPayoutCents,
    ruleImpliedProbability: m.analysis.ruleImpliedProbability,
  });
  if (bet.evPercent == null || bet.evPercent <= 0) return -1;
  return upsidePercent(bet.entryCents) ?? -1;
}

export default function Home() {
  return <MarketsView />;
}

export function MarketsView({ initialKind = "" as Kind }: { initialKind?: Kind }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("score");
  const [kind, setKind] = useState<Kind>(initialKind);
  const [minDiv, setMinDiv] = useState(DEFAULT_DIV);
  const [minScore, setMinScore] = useState(DEFAULT_SCORE);
  const [verify, setVerify] = useState<Verify>("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["picks", q, kind, minDiv, minScore, verify],
    queryFn: () => fetchMerged(q, kind, minDiv, minScore, verify),
    refetchInterval: 60_000,
  });

  const picks = useMemo(() => {
    const list = [...(data ?? []).filter((m) => m.analysis)];
    list.sort((a, b) => {
      const A = a.analysis!, B = b.analysis!;
      switch (sort) {
        case "mismatch": return (B.divergenceScore - A.divergenceScore) || (B.edgeScore - A.edgeScore);
        case "upside": return entryUpside(b) - entryUpside(a);
        case "votes": return (b.votes.up - b.votes.down) - (a.votes.up - a.votes.down);
        case "soon": return (a.endDate ? new Date(a.endDate).getTime() : Infinity) - (b.endDate ? new Date(b.endDate).getTime() : Infinity);
        case "new": return (b.foundAt ? new Date(b.foundAt).getTime() : 0) - (a.foundAt ? new Date(a.foundAt).getTime() : 0);
        default: return B.edgeScore - A.edgeScore;
      }
    });
    return list;
  }, [data, sort]);

  const activeFilterCount = (kind ? 1 : 0) + (minDiv !== DEFAULT_DIV ? 1 : 0) + (minScore !== DEFAULT_SCORE ? 1 : 0) + (verify ? 1 : 0);
  function resetFilters() { setKind(""); setMinDiv(DEFAULT_DIV); setMinScore(DEFAULT_SCORE); setVerify(""); }

  return (
    <AppShell>
      <OnboardingDialog />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <header className="max-w-2xl mb-8">
          <h1 className="font-display text-[34px] sm:text-[44px] leading-[1.05] tight text-[var(--text)]">Today&apos;s picks</h1>
          <p className="text-[16px] sm:text-[17px] text-[var(--text-muted)] mt-3 leading-relaxed">
            Bets where the crowd is probably wrong. We read the rules and the news so you don&apos;t have to. You decide.
          </p>
        </header>

        {/* Search + Filters */}
        <div className="flex items-center gap-3 mb-4">
          <label className="search flex-1">
            <Search className="w-5 h-5 text-[var(--text-dim)] shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by topic, e.g. Fed, election, Bitcoin" />
            {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-[var(--text-dim)] hover:text-[var(--text)]"><X className="w-4 h-4" /></button>}
          </label>
          <button onClick={() => setFiltersOpen(true)} className={cn("pill h-[52px] px-5", activeFilterCount > 0 && "pill-on")}>
            <SlidersHorizontal className="w-4 h-4" />
            Filters
            {activeFilterCount > 0 && <span className="ml-0.5 rounded-full bg-[var(--accent-fg)]/25 px-1.5 text-[12px]">{activeFilterCount}</span>}
          </button>
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6 -mx-1 px-1">
          <span className="text-[13px] text-[var(--text-dim)] shrink-0 mr-1">Sort by</span>
          {SORTS.map((s) => (
            <button key={s.id} onClick={() => setSort(s.id)} className={cn("pill shrink-0", sort === s.id && "pill-on")}>{s.label}</button>
          ))}
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-80 rounded-[var(--radius-lg)]" />)}
          </div>
        ) : picks.length === 0 ? (
          <EmptyState hasFilters={activeFilterCount > 0 || !!q} onReset={() => { resetFilters(); setQ(""); }} />
        ) : (
          <>
            <div className="text-[14px] text-[var(--text-muted)] mb-5">{picks.length} {picks.length === 1 ? "pick" : "picks"}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 stagger">
              {picks.map((m) => <OpportunityCard key={m.id} {...m} />)}
            </div>
          </>
        )}
      </div>

      {/* Filter sheet */}
      {filtersOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
          <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={() => setFiltersOpen(false)} />
          <div className="relative w-full sm:max-w-md card-elev rounded-b-none sm:rounded-[var(--radius-xl)] rounded-t-[var(--radius-xl)] p-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] animate-rise-in max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h2 className="font-display text-[22px] text-[var(--text)]">Filters</h2>
              <button onClick={() => setFiltersOpen(false)} className="p-2 rounded-full hover:bg-[var(--bg-overlay)]" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>

            <Group label="Why it's a pick">
              <Choice on={kind === ""} onClick={() => setKind("")}>Any reason</Choice>
              <Choice on={kind === "rule"} onClick={() => setKind("rule")}>A hidden rule</Choice>
              <Choice on={kind === "news"} onClick={() => setKind("news")}>The news moved</Choice>
            </Group>

            <Group label="How big is the mismatch?">
              {DIV_LEVELS.map((v) => (
                <Choice key={v} on={minDiv === v} onClick={() => setMinDiv(v)}>{v === 0 ? "Any" : `${v}+`}</Choice>
              ))}
            </Group>

            <Group label="How strong is the pick?">
              {SCORE_LEVELS.map((v) => (
                <Choice key={v} on={minScore === v} onClick={() => setMinScore(v)}>{v === 0 ? "Any" : `${v}+`}</Choice>
              ))}
            </Group>

            <Group label="How it was checked" hint={verify && (verify === "both" || verify === "agree" || verify === "disagree") ? "Strength/score floors eased for these" : undefined}>
              {VERIFY_LABELS.map((v) => (
                <Choice key={v.id} on={verify === v.id} onClick={() => setVerify(v.id)}>{v.label}</Choice>
              ))}
            </Group>

            <div className="flex items-center justify-between gap-3 mt-6 pt-5 border-t border-[var(--border)]">
              <button onClick={resetFilters} className="btn btn-ghost">Reset</button>
              <button onClick={() => setFiltersOpen(false)} className="btn btn-primary"><Check className="w-4 h-4" /> Show {picks.length} picks</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Group({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <div className="flex items-baseline justify-between gap-2 mb-2.5">
        <div className="text-[13px] font-semibold text-[var(--text-muted)]">{label}</div>
        {hint && <div className="text-[11px] text-[var(--text-dim)]">{hint}</div>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} className={cn("pill", on && "pill-on")}>{children}</button>;
}

function EmptyState({ hasFilters, onReset }: { hasFilters: boolean; onReset: () => void }) {
  return (
    <div className="card card-pad text-center py-16">
      <div className="font-display text-[22px] text-[var(--text)] mb-2">Nothing to show right now</div>
      <p className="text-[15px] text-[var(--text-muted)] max-w-sm mx-auto mb-5">
        {hasFilters ? "No picks match what you searched for. Try easing your filters." : "There are no picks today. Check back after the next daily scan."}
      </p>
      {hasFilters && <button onClick={onReset} className="btn btn-primary">Reset filters</button>}
    </div>
  );
}
