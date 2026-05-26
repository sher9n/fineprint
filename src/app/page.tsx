"use client";

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Sparkles, X } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { OpportunityCard } from "@/components/OpportunityCard";
import { OpportunityRow } from "@/components/OpportunityRow";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { ViewSwitcher, type ViewMode } from "@/components/ViewSwitcher";

type Sort = "edge" | "votes" | "endDate" | "liquidity" | "divergence" | "recent";
type Side = "" | "YES" | "NO";
type VerifyStage = "" | "synthesis" | "synthesis_agreed" | "synthesis_disagreed" | "opus_only" | "initial";
const VERIFY_STAGE_LABELS: Record<VerifyStage, string> = {
  "": "any verification",
  synthesis: "both models run",
  synthesis_agreed: "both models agree",
  synthesis_disagreed: "models disagree",
  opus_only: "Opus only (no GPT)",
  initial: "first-pass only",
};
const VIEW_STORAGE_KEY = "fineprint_view_mode";

export default function Home() {
  const [sort, setSort] = useState<Sort>("edge");
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(15);
  const [minDivergence, setMinDivergence] = useState(6);
  const [side, setSide] = useState<Side>("");
  const [verifyStage, setVerifyStage] = useState<VerifyStage>("");
  const [view, setView] = useState<ViewMode>("cards");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "list" || saved === "cards") setView(saved);
  }, []);

  function changeView(v: ViewMode) {
    setView(v);
    if (typeof window !== "undefined") localStorage.setItem(VIEW_STORAGE_KEY, v);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["markets", sort, q, minScore, minDivergence, side, verifyStage],
    queryFn: async () => {
      const params = new URLSearchParams({
        sort,
        minScore: String(minScore),
        minDivergence: String(minDivergence),
        ...(q ? { q } : {}),
        ...(side ? { direction: side } : {}),
        ...(verifyStage ? { verifyStage } : {}),
      });
      const res = await fetch(`/api/markets?${params}`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<{
        markets: Array<Parameters<typeof OpportunityCard>[0]>;
        total: number;
      }>;
    },
    refetchInterval: 60_000,
  });

  const activeFilters = [
    minDivergence > 0 ? `divergence ≥ ${minDivergence}` : null,
    minScore > 0 ? `score ≥ ${minScore}` : null,
    side ? `bet ${side}` : null,
    verifyStage ? VERIFY_STAGE_LABELS[verifyStage] : null,
  ].filter(Boolean);

  function resetFilters() {
    setMinScore(15);
    setMinDivergence(6);
    setSide("");
    setVerifyStage("");
    setQ("");
  }

  return (
    <AppShell>
      <OnboardingDialog />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
            Today&apos;s opportunities
          </h1>
          <p className="text-sm sm:text-base text-[var(--text-muted)] mt-1.5 max-w-2xl">
            Markets where the rules quietly say something different from what most bettors see. We read the fine print, you decide.
          </p>
        </div>

        {/* Filter bar */}
        <div className="card p-3 sm:p-4 mb-5 space-y-3">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-[var(--text-dim)] shrink-0" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search opportunities…"
              className="bg-transparent outline-none text-sm flex-1 placeholder:text-[var(--text-dim)] w-full"
            />
            <div className="shrink-0">
              <ViewSwitcher value={view} onChange={changeView} />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Filter label="Sort" value={sort} onChange={(v) => setSort(v as Sort)} options={[
              { value: "edge", label: "Score ↓" },
              { value: "divergence", label: "Mismatch ↓" },
              { value: "votes", label: "Most voted" },
              { value: "endDate", label: "Trading ends soon" },
              { value: "liquidity", label: "Most liquid" },
              { value: "recent", label: "Recently found" },
            ]} />
            <Filter label="Min divergence" value={String(minDivergence)} onChange={(v) => setMinDivergence(Number(v))} options={[
              { value: "0", label: "Any" },
              { value: "4", label: "≥ 4 (minor+)" },
              { value: "5", label: "≥ 5" },
              { value: "6", label: "≥ 6 (real)" },
              { value: "7", label: "≥ 7 (clear)" },
              { value: "8", label: "≥ 8" },
              { value: "9", label: "≥ 9 (dramatic)" },
            ]} />
            <Filter label="Min score" value={String(minScore)} onChange={(v) => setMinScore(Number(v))} options={[
              { value: "0", label: "Any" },
              { value: "15", label: "≥ 15" },
              { value: "30", label: "≥ 30 (worth a look)" },
              { value: "50", label: "≥ 50 (solid)" },
              { value: "70", label: "≥ 70 (strong)" },
            ]} />
            <Filter label="Bet side" value={side} onChange={(v) => setSide(v as Side)} options={[
              { value: "", label: "Any" },
              { value: "YES", label: "YES only" },
              { value: "NO", label: "NO only" },
            ]} />
            <Filter label="Verification" value={verifyStage} onChange={(v) => {
              const next = v as VerifyStage;
              setVerifyStage(next);
              // The synthesis pass deliberately lowers divergence_score when models disagree
              // (max 5, often 3-4), so the default ≥6 silently hides them. When the user is
              // explicitly asking for these signals, drop the min filters so the markets they
              // selected actually appear. Reset button restores defaults.
              if (next === "synthesis" || next === "synthesis_agreed" || next === "synthesis_disagreed") {
                setMinScore(0);
                setMinDivergence(0);
              }
            }} options={[
              { value: "", label: "Any" },
              { value: "synthesis", label: "Both models run" },
              { value: "synthesis_agreed", label: "Both models agree" },
              { value: "synthesis_disagreed", label: "Models disagree" },
              { value: "opus_only", label: "Opus only (no GPT)" },
              { value: "initial", label: "First-pass only" },
            ]} />
            {activeFilters.length > 0 && (
              <button onClick={resetFilters} className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--text)] inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-[var(--bg-overlay)]">
                <X className="w-3 h-3" /> Reset
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          view === "cards" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-72" />)}
            </div>
          ) : (
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => <div key={i} className="skeleton h-16" />)}
            </div>
          )
        ) : data?.markets.length === 0 ? (
          <EmptyState onReset={resetFilters} />
        ) : (
          <>
            <div className="text-xs text-[var(--text-dim)] mb-3 flex items-center gap-2 flex-wrap">
              <span>Showing {data?.markets.length} of {data?.total} opportunities</span>
              {activeFilters.length > 0 && (
                <>
                  <span>·</span>
                  {activeFilters.map((f, i) => (
                    <span key={i} className="chip text-[10px]">{f}</span>
                  ))}
                </>
              )}
            </div>
            {view === "cards" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                {data?.markets.map((m) => (
                  <OpportunityCard key={m.id} {...m} />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {data?.markets.map((m) => (
                  <OpportunityRow key={m.id} {...m} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const isDefault = options[0]?.value === value;
  return (
    <label className={`inline-flex items-center gap-1.5 text-xs ${isDefault ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}>
      <span className="uppercase tracking-wider text-[10px] text-[var(--text-dim)]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`bg-transparent outline-none text-xs cursor-pointer rounded-md px-1.5 py-0.5 border ${isDefault ? "border-transparent hover:border-[var(--border)]" : "border-[var(--accent)]/40 bg-[var(--accent-soft)]/40"}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[var(--bg-elev)] text-[var(--text)]">{o.label}</option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="card p-10 sm:p-16 text-center">
      <Sparkles className="w-10 h-10 text-[var(--text-dim)] mx-auto mb-4" />
      <h3 className="text-lg font-medium mb-1">No opportunities match these filters</h3>
      <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
        Try widening the filters or check back after the next daily run.
      </p>
      <button onClick={onReset} className="btn btn-primary">Reset filters</button>
    </div>
  );
}
