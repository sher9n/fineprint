"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronDown, Layers, List, LayoutGrid } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

interface Leg { id: string; label: string; yesPrice: number | null; liquidity: number; endDate: string | null }
interface Cand {
  negRiskMarketId: string;
  eventTitle: string | null;
  eventSlug: string | null;
  outcomes: number;
  yesSum: number;
  direction: "buy_all_no" | "buy_all_yes";
  requiresExhaustive: boolean;
  lockPerBasket: number;
  costPerBasket: number;
  totalReturnPct: number;
  daysToResolve: number | null;
  dailyReturnPct: number | null;
  minLegLiquidity: number;
  legs: Leg[];
}
type Sort = "total" | "daily";
type View = "list" | "grid";
interface Resp { counts: { negRiskGroups: number; locks: number; conditional: number }; locks: Cand[]; conditional: Cand[] }

const EDGE = [{ v: 0.01, label: "1c+" }, { v: 0.02, label: "2c+" }, { v: 0.05, label: "5c+" }];
const LIQ = [{ v: 1000, label: "$1k+" }, { v: 5000, label: "$5k+" }];
const SORTS: { v: Sort; label: string }[] = [{ v: "total", label: "Total return" }, { v: "daily", label: "Daily return" }];

async function fetchArb(minEdge: number, liq: number, sort: Sort): Promise<Resp> {
  const res = await fetch(`/api/screener/arbitrage?minEdge=${minEdge}&maxDev=0.15&minLiquidity=${liq}&sort=${sort}`);
  if (!res.ok) throw new Error("fetch failed");
  return res.json();
}

export default function ArbitragePage() {
  const [minEdge, setMinEdge] = useState(0.02);
  const [liq, setLiq] = useState(1000);
  const [sort, setSort] = useState<Sort>("daily");
  const [view, setView] = useState<View>("grid");
  const { data, isLoading } = useQuery({
    queryKey: ["arb", minEdge, liq, sort],
    queryFn: () => fetchArb(minEdge, liq, sort),
    refetchInterval: 120_000,
  });
  const locks = data?.locks ?? [];
  const conditional = data?.conditional ?? [];

  const renderItems = (items: Cand[]) =>
    view === "grid" ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 stagger">
        {items.map((c) => <BasketGridCard key={c.negRiskMarketId} c={c} sort={sort} />)}
      </div>
    ) : (
      <div className="space-y-3">
        {items.map((c) => <BasketRow key={c.negRiskMarketId} c={c} sort={sort} />)}
      </div>
    );

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <header className="max-w-2xl mb-7">
          <h1 className="font-display text-[34px] sm:text-[44px] leading-[1.05] tight text-[var(--text)]">Basket mispricings</h1>
          <p className="text-[16px] sm:text-[17px] text-[var(--text-muted)] mt-3 leading-relaxed">
            In a multi-outcome market exactly one side wins, so the YES prices should add up to $1. When they add up to more,
            buying NO on every outcome locks the difference, no matter which one wins. It is the same overpriced-longshot edge,
            captured across a whole field at once.
          </p>
          <div className="mt-4 flex items-start gap-2 text-[13px] text-[var(--text-dim)] rounded-[var(--radius-md)] bg-[var(--bg-sunken)] p-3.5 leading-relaxed">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              These use last-trade prices, not the live order book, so the gap may not be fillable at these prices, and you must
              buy every leg. On-platform these gaps are usually small and short-lived. Confirm on Polymarket before trading. Not financial advice.
            </span>
          </div>
        </header>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-7">
          <Control label="Min lock">
            {EDGE.map((e) => <button key={e.v} onClick={() => setMinEdge(e.v)} className={cn("pill", minEdge === e.v && "pill-on")}>{e.label}</button>)}
          </Control>
          <Control label="Liquidity / leg">
            {LIQ.map((l) => <button key={l.v} onClick={() => setLiq(l.v)} className={cn("pill", liq === l.v && "pill-on")}>{l.label}</button>)}
          </Control>
          <Control label="Sort by">
            {SORTS.map((s) => <button key={s.v} onClick={() => setSort(s.v)} className={cn("pill", sort === s.v && "pill-on")}>{s.label}</button>)}
          </Control>
        </div>

        {isLoading ? (
          view === "grid" ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">{[...Array(6)].map((_, i) => <div key={i} className="skeleton h-64 rounded-[var(--radius-lg)]" />)}</div>
          ) : (
            <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="skeleton h-24 rounded-[var(--radius-lg)]" />)}</div>
          )
        ) : locks.length === 0 && conditional.length === 0 ? (
          <div className="card card-pad text-center py-16">
            <div className="font-display text-[22px] text-[var(--text)] mb-2">No basket mispricings right now</div>
            <p className="text-[15px] text-[var(--text-muted)] max-w-md mx-auto">Across {data?.counts.negRiskGroups ?? 0} multi-outcome groups, none deviate from $1 by your threshold at this liquidity. That is the usual state, the platform keeps these tight. Lower the threshold to see smaller gaps.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="text-[14px] text-[var(--text-muted)]">{locks.length} robust {locks.length === 1 ? "lock" : "locks"} (buy every NO){conditional.length > 0 && <span className="text-[var(--text-dim)]"> · {conditional.length} conditional</span>}</div>
              <ViewToggle view={view} setView={setView} />
            </div>
            {renderItems(locks)}

            {conditional.length > 0 && (
              <section className="mt-12">
                <h2 className="font-display text-[22px] text-[var(--text)]">Conditional (only if the field is complete)</h2>
                <p className="text-[14px] text-[var(--text-muted)] mt-1.5 mb-4 max-w-2xl">
                  Here the YES prices add up to less than $1. Buying every YES only pays out if one of these listed outcomes
                  must win. Usually the gap is just the chance of an unlisted &ldquo;other&rdquo; or &ldquo;none&rdquo; outcome, so treat these as leads, not locks.
                </p>
                {renderItems(conditional)}
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><span className="text-[13px] text-[var(--text-dim)] shrink-0">{label}</span><div className="flex items-center gap-2">{children}</div></div>;
}

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  const cls = (v: View) => cn("p-1.5 rounded-full transition-colors", view === v ? "bg-[var(--bg-elev-2)] text-[var(--text)]" : "text-[var(--text-dim)] hover:text-[var(--text)]");
  return (
    <div className="inline-flex items-center gap-0.5 rounded-full border border-[var(--border)] p-0.5 bg-[var(--bg-elev)] shrink-0">
      <button onClick={() => setView("grid")} aria-label="Grid view" aria-pressed={view === "grid"} className={cls("grid")}><LayoutGrid className="w-4 h-4" /></button>
      <button onClick={() => setView("list")} aria-label="List view" aria-pressed={view === "list"} className={cls("list")}><List className="w-4 h-4" /></button>
    </div>
  );
}

// Shared metric formatting: the primary figure (emphasised) follows the active sort; the other
// return is shown as the secondary line so both are always visible.
function returnParts(c: Cand, sort: Sort): { primary: React.ReactNode; secondary: string } {
  const daily = c.dailyReturnPct;
  const days = c.daysToResolve;
  if (sort === "daily") {
    return {
      primary: <>{daily != null ? `+${daily}%` : "n/a"}<span className="text-[11px] font-normal text-[var(--text-dim)]">/day</span></>,
      secondary: `+${c.totalReturnPct}% total${days != null ? ` · ${days}d` : ""}`,
    };
  }
  return {
    primary: <>+{c.totalReturnPct}%<span className="text-[11px] font-normal text-[var(--text-dim)]"> total</span></>,
    secondary: `${daily != null ? `~${daily}%/day` : "horizon n/a"}${days != null ? ` · ${days}d` : ""}`,
  };
}

function moneyShort(v: number) {
  return v >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;
}

// Shared expandable panel: cost/lock summary plus the per-leg list. Used by both layouts.
function LegsDetail({ c }: { c: Cand }) {
  const isNo = c.direction === "buy_all_no";
  return (
    <div className="border-t border-[var(--border)] px-4 sm:px-5 py-3 bg-[var(--bg-sunken)]">
      <div className="text-[12px] text-[var(--text-muted)] mb-2">
        Costs <span className="mono text-[var(--text)]">${c.costPerBasket.toFixed(3)}</span> per basket, locks{" "}
        <span className="mono text-[var(--text)]">${c.lockPerBasket.toFixed(3)}</span> ({c.totalReturnPct}% total{c.daysToResolve != null && `, ~${c.dailyReturnPct}%/day over ${c.daysToResolve}d`}).
      </div>
      <div className="text-[12px] text-[var(--text-dim)] mb-2">{c.outcomes} legs (buy {isNo ? "NO" : "YES"} on each):</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
        {c.legs.map((l) => (
          <Link key={l.id} href={`/markets/${l.id}`} className="flex items-center justify-between gap-3 text-[13px] hover:text-[var(--accent)]">
            <span className="text-[var(--text-muted)] truncate">{l.label}</span>
            <span className="mono text-[var(--text-dim)] shrink-0">{isNo ? `NO ${Math.round((1 - (l.yesPrice ?? 0)) * 100)}c` : `YES ${Math.round((l.yesPrice ?? 0) * 100)}c`}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function BasketRow({ c, sort }: { c: Cand; sort: Sort }) {
  const [open, setOpen] = useState(false);
  const isNo = c.direction === "buy_all_no";
  const { primary, secondary } = returnParts(c, sort);
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="w-full text-left p-4 sm:p-5 flex items-center gap-4 hover:bg-[var(--bg-overlay)] transition-colors">
        <Layers className="w-5 h-5 text-[var(--accent)] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] sm:text-[16px] text-[var(--text)] font-medium truncate">{c.eventTitle ?? "Multi-outcome group"}</div>
          <div className="text-[13px] text-[var(--text-muted)] mt-0.5">
            Buy <span className="font-semibold">{isNo ? "NO" : "YES"}</span> on all <span className="mono">{c.outcomes}</span> outcomes
            <span className="mx-1.5 text-[var(--text-dim)]">&middot;</span>YES sum <span className="mono">{c.yesSum.toFixed(3)}</span>
            <span className="mx-1.5 text-[var(--text-dim)]">&middot;</span>smallest leg <span className="mono">{moneyShort(c.minLegLiquidity)}</span>
          </div>
        </div>
        <div className="text-right shrink-0 min-w-[96px]">
          <div className="mono text-[16px] font-bold text-[var(--green)]">{primary}</div>
          <div className="text-[11px] text-[var(--text-dim)]">{secondary}</div>
        </div>
        <ChevronDown className={cn("w-4 h-4 text-[var(--text-dim)] shrink-0 transition-transform", open && "rotate-180")} />
      </button>
      {open && <LegsDetail c={c} />}
    </div>
  );
}

function BasketGridCard({ c, sort }: { c: Cand; sort: Sort }) {
  const [open, setOpen] = useState(false);
  const isNo = c.direction === "buy_all_no";
  const { primary, secondary } = returnParts(c, sort);
  return (
    <article className="card lift flex flex-col overflow-hidden">
      <div className="p-5 sm:p-6 flex flex-col gap-4 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--text-muted)]"><Layers className="w-3.5 h-3.5 text-[var(--accent)]" /> Basket</span>
          <span className="text-[12px] mono text-[var(--text-dim)]">{c.outcomes} outcomes</span>
        </div>

        <h3 className="font-display text-[19px] sm:text-[20px] leading-[1.25] text-[var(--text)] line-clamp-3">{c.eventTitle ?? "Multi-outcome group"}</h3>

        <div className="text-[13px] text-[var(--text-muted)]">
          {c.daysToResolve != null ? `${c.daysToResolve}d to resolve` : "no end date"}
          <span className="mx-2 text-[var(--text-dim)]">&middot;</span>YES sum <span className="mono">{c.yesSum.toFixed(3)}</span>
          <span className="mx-2 text-[var(--text-dim)]">&middot;</span>min leg <span className="mono">{moneyShort(c.minLegLiquidity)}</span>
        </div>

        <div className="mt-auto rounded-[var(--radius-md)] p-4" style={{ background: "var(--green-soft)" }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[19px] leading-tight text-[var(--text)]">
              Buy <span className="text-[var(--green)]">{isNo ? "NO" : "YES"}</span> on all {c.outcomes}
            </span>
            <span className="mono text-[16px] font-bold text-[var(--green)] shrink-0">{primary}</span>
          </div>
          <div className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">{secondary}<span className="mx-1.5 text-[var(--text-dim)]">&middot;</span>locks <span className="mono">${c.lockPerBasket.toFixed(3)}</span>/basket</div>
        </div>
      </div>

      <button onClick={() => setOpen((o) => !o)} className="px-5 sm:px-6 py-3 border-t border-[var(--border)] flex items-center justify-between text-[13px] font-semibold text-[var(--accent)] hover:bg-[var(--bg-overlay)] transition-colors">
        <span>{open ? "Hide legs" : `Show ${c.outcomes} legs`}</span>
        <ChevronDown className={cn("w-4 h-4 transition-transform", open && "rotate-180")} />
      </button>
      {open && <LegsDetail c={c} />}
    </article>
  );
}
