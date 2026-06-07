"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ShieldCheck, ShieldAlert, AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { resolutionTimeline } from "@/lib/explain";
import { cn } from "@/lib/utils";

type Safety = "confirmed" | "soft" | "unverified" | "flagged";
interface Row {
  id: string;
  question: string;
  eventTitle: string | null;
  groupItemTitle: string | null;
  yesPrice: number | null;
  noPrice: number | null;
  liquidity: number;
  endDate: string | null;
  favoriteSide: "YES" | "NO";
  favPriceCents: number;
  edgeCents: number;
  returnPct: number;
  daysToResolve: number;
  dailyReturnPct: number;
  safety: Safety;
  model: { ruleImpliedProbability: number | null; modelFavoriteProb: number | null; modelSide: string; divergenceScore: number; divergenceType: string; pass: string } | null;
}
interface Resp {
  counts: { scanned: number; tradeable: number; flagged: number };
  tradeable: Row[];
  flagged: Row[];
}

const DAYS = [7, 14, 30, 60];
const FAV = [
  { v: 0.9, label: "90c+" },
  { v: 0.95, label: "95c+" },
];
const LIQ = [
  { v: 5000, label: "$5k+" },
  { v: 25000, label: "$25k+" },
];

async function fetchScreener(days: number, fav: number, liq: number): Promise<Resp> {
  const res = await fetch(`/api/screener/near-certain?days=${days}&favFloor=${fav}&minLiquidity=${liq}`);
  if (!res.ok) throw new Error("fetch failed");
  return res.json();
}

export default function NearCertainPage() {
  const [days, setDays] = useState(30);
  const [fav, setFav] = useState(0.9);
  const [liq, setLiq] = useState(5000);

  const { data, isLoading } = useQuery({
    queryKey: ["near-certain", days, fav, liq],
    queryFn: () => fetchScreener(days, fav, liq),
    refetchInterval: 120_000,
  });

  const tradeable = data?.tradeable ?? [];
  const flagged = data?.flagged ?? [];

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <header className="max-w-2xl mb-7">
          <h1 className="font-display text-[34px] sm:text-[44px] leading-[1.05] tight text-[var(--text)]">Near-certain, resolving soon</h1>
          <p className="text-[16px] sm:text-[17px] text-[var(--text-muted)] mt-3 leading-relaxed">
            Heavy favorites that should settle within weeks. The upside per bet is small but it hits often, and your money frees up
            fast. We hide the ones where reading the fine print suggests the &ldquo;sure thing&rdquo; could bite.
          </p>
          <div className="mt-4 flex items-start gap-2 text-[13px] text-[var(--text-dim)] rounded-[var(--radius-md)] bg-[var(--bg-sunken)] p-3.5 leading-relaxed">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              You win a few cents and risk many. One upset erases a string of wins, so only do this spread across many unrelated
              markets, and check the live order book first, the edge can vanish in the spread. Not financial advice.
            </span>
          </div>
        </header>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-7">
          <Control label="Resolves within">
            {DAYS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={cn("pill", days === d && "pill-on")}>{d}d</button>
            ))}
          </Control>
          <Control label="Favorite at least">
            {FAV.map((f) => (
              <button key={f.v} onClick={() => setFav(f.v)} className={cn("pill", fav === f.v && "pill-on")}>{f.label}</button>
            ))}
          </Control>
          <Control label="Liquidity">
            {LIQ.map((l) => (
              <button key={l.v} onClick={() => setLiq(l.v)} className={cn("pill", liq === l.v && "pill-on")}>{l.label}</button>
            ))}
          </Control>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-56 rounded-[var(--radius-lg)]" />)}
          </div>
        ) : tradeable.length === 0 && flagged.length === 0 ? (
          <div className="card card-pad text-center py-16">
            <div className="font-display text-[22px] text-[var(--text)] mb-2">Nothing near-certain right now</div>
            <p className="text-[15px] text-[var(--text-muted)] max-w-sm mx-auto">No heavy favorites resolve within {days} days at this liquidity. Try a longer window or lower the liquidity floor.</p>
          </div>
        ) : (
          <>
            <div className="text-[14px] text-[var(--text-muted)] mb-5">
              {tradeable.length} near-{tradeable.length === 1 ? "lock" : "locks"}
              {flagged.length > 0 && <span className="text-[var(--text-dim)]"> · {flagged.length} where a rule may bite</span>}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 stagger">
              {tradeable.map((r) => <NearLockCard key={r.id} r={r} />)}
            </div>

            {flagged.length > 0 && (
              <section className="mt-12">
                <h2 className="font-display text-[24px] text-[var(--text)] flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-amber-500" /> Looks certain, but a rule may bite
                </h2>
                <p className="text-[14px] text-[var(--text-muted)] mt-1.5 mb-5 max-w-2xl">
                  The crowd prices these as near-locks, but our rules read leans the other way. These are the traps the screener removed, kept here so you can judge for yourself.
                </p>
                <div className="space-y-3">
                  {flagged.map((r) => <FlaggedRow key={r.id} r={r} />)}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}

function Control({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-[var(--text-dim)] shrink-0">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

const SAFETY_BADGE: Record<Safety, { label: string; cls: string; Icon: typeof ShieldCheck } | null> = {
  confirmed: { label: "Rules check: clear", cls: "text-[var(--green)]", Icon: ShieldCheck },
  soft: { label: "Rules check: ok", cls: "text-[var(--text-muted)]", Icon: ShieldCheck },
  unverified: { label: "Not yet rules-checked", cls: "text-[var(--text-dim)]", Icon: ShieldCheck },
  flagged: null,
};

function NearLockCard({ r }: { r: Row }) {
  const isYes = r.favoriteSide === "YES";
  const title = r.eventTitle && r.groupItemTitle ? `${r.eventTitle}: ${r.groupItemTitle}` : r.question;
  const moneyK = r.liquidity >= 1000 ? `$${(r.liquidity / 1000).toFixed(0)}k` : `$${r.liquidity.toFixed(0)}`;
  const badge = SAFETY_BADGE[r.safety];

  return (
    <article className="card lift relative flex flex-col overflow-hidden">
      <Link href={`/markets/${r.id}`} className="absolute inset-0 z-0" aria-label={title} />
      <div className="p-5 sm:p-6 flex flex-col gap-4 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-muted)]">Near-certain</span>
          {badge && (
            <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", badge.cls)}>
              <badge.Icon className="w-3.5 h-3.5" /> {badge.label}
            </span>
          )}
        </div>

        <h3 className="font-display text-[19px] sm:text-[20px] leading-[1.25] text-[var(--text)] line-clamp-3">{title}</h3>

        <div className="text-[13px] text-[var(--text-muted)]">
          {resolutionTimeline(r.endDate, r.groupItemTitle)}
          <span className="mx-2 text-[var(--text-dim)]">&middot;</span>
          <span className="mono">{moneyK}</span> in play
        </div>

        <div className="mt-auto rounded-[var(--radius-md)] p-4" style={{ background: isYes ? "var(--green-soft)" : "var(--red-soft)" }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-display text-[21px] leading-none text-[var(--text)]">
              Buy <span className={isYes ? "text-[var(--green)]" : "text-[var(--red)]"}>{r.favoriteSide}</span>{" "}
              <span className="mono text-[16px] text-[var(--text-muted)]">{r.favPriceCents}c</span>
            </span>
            <span className={cn("mono text-[15px] font-bold", isYes ? "text-[var(--green)]" : "text-[var(--red)]")}>+{r.returnPct}%</span>
          </div>
          <div className="mt-1.5 text-[12.5px] text-[var(--text-muted)]">
            Win <span className="mono text-[var(--text)]">{r.edgeCents}c</span> if right, lose <span className="mono text-[var(--text)]">{r.favPriceCents}c</span> if wrong
            <span className="mx-1.5 text-[var(--text-dim)]">&middot;</span>
            <span className="mono">~{r.dailyReturnPct}%/day</span> over {r.daysToResolve}d
          </div>
        </div>
      </div>
      <div className="px-5 sm:px-6 py-3 border-t border-[var(--border)] flex items-center justify-end">
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[var(--accent)]">See the rules <ArrowRight className="w-4 h-4" /></span>
      </div>
    </article>
  );
}

function FlaggedRow({ r }: { r: Row }) {
  const title = r.eventTitle && r.groupItemTitle ? `${r.eventTitle}: ${r.groupItemTitle}` : r.question;
  const mp = r.model?.modelFavoriteProb;
  return (
    <Link href={`/markets/${r.id}`} className="card card-pad lift flex items-center gap-4 hover:border-[var(--border-strong)]">
      <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] text-[var(--text)] font-medium truncate">{title}</div>
        <div className="text-[13px] text-[var(--text-muted)] mt-0.5">
          Crowd prices <span className="mono">{r.favoriteSide} {r.favPriceCents}c</span>, but our rules read leans{" "}
          <span className="font-semibold">{r.model?.modelSide ?? "the other way"}</span>
          {mp != null && <span> (we put the favorite near <span className="mono">{Math.round(mp * 100)}%</span>)</span>}
        </div>
      </div>
      <ArrowRight className="w-4 h-4 text-[var(--accent)] shrink-0" />
    </Link>
  );
}
