"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { fmtIstShort } from "@/lib/time";

interface BetRow {
  id: string;
  marketId: string;
  side: string;
  priceAtBet: number;
  sizeUsd: number;
  status: string;
  pnlUsd: number | null;
  placedAt: string;
  rationale: string | null;
  market: { question: string; slug: string; eventTitle: string | null; groupItemTitle: string | null };
}

export default function BetsPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const { data, refetch } = useQuery({
    queryKey: ["bets"],
    queryFn: async () => {
      const res = await fetch("/api/bets");
      return res.json() as Promise<{ bets: BetRow[] }>;
    },
    enabled: !!session,
  });

  async function resolve(id: string, status: "won" | "lost" | "void") {
    await fetch(`/api/bets/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["picks"] });
    toast.success(`Marked ${status}`);
  }
  async function remove(id: string) {
    if (!confirm("Delete this bet?")) return;
    await fetch(`/api/bets/${id}`, { method: "DELETE" });
    refetch();
  }

  if (!session) return <SignedOut title="Sign in to see your bets" body="Your bets and how they're doing, in one place." />;

  const bets = data?.bets ?? [];
  const totals = bets.reduce(
    (acc, b) => {
      if (b.status === "open") acc.open += b.sizeUsd;
      else if (b.status === "won") { acc.won += 1; acc.pnl += (b.sizeUsd / b.priceAtBet) - b.sizeUsd; }
      else if (b.status === "lost") { acc.lost += 1; acc.pnl -= b.sizeUsd; }
      return acc;
    },
    { open: 0, won: 0, lost: 0, pnl: 0 }
  );
  const total = totals.won + totals.lost;
  const winRate = total > 0 ? totals.won / total : 0;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-7">
        <header className="max-w-2xl">
          <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.06] tight text-[var(--text)]">My bets</h1>
          <p className="text-[16px] text-[var(--text-muted)] mt-3 leading-relaxed">
            Bets you&apos;ve logged. Mark them won or lost when they settle to track how you&apos;re doing.
          </p>
        </header>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Money in open bets" value={`$${totals.open.toFixed(0)}`} />
          <StatCard label="Wins" value={totals.won.toString()} accent="green" />
          <StatCard label="Losses" value={totals.lost.toString()} accent="red" />
          <StatCard label="Win rate" value={total > 0 ? `${(winRate * 100).toFixed(0)}%` : "-"} sub={total > 0 ? `${total} settled` : "nothing settled yet"} accent={total === 0 ? undefined : winRate >= 0.5 ? "green" : "red"} />
        </div>

        {bets.length === 0 ? (
          <div className="card card-pad text-center py-14">
            <div className="font-display text-[20px] text-[var(--text)] mb-2">No bets yet</div>
            <p className="text-[15px] text-[var(--text-muted)] max-w-sm mx-auto mb-5">Your tracked bets will show up here.</p>
            <Link href="/" className="btn btn-primary">See today&apos;s picks</Link>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-[14px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left font-semibold px-5 py-3.5">Market</th>
                  <th className="text-left font-semibold px-3 py-3.5">Side</th>
                  <th className="text-left font-semibold px-3 py-3.5">Stake</th>
                  <th className="text-left font-semibold px-3 py-3.5 hidden sm:table-cell">Placed</th>
                  <th className="text-left font-semibold px-3 py-3.5">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bets.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-5 py-3.5 max-w-md">
                      <Link href={`/markets/${b.marketId}`} className="hover:text-[var(--accent)] font-medium line-clamp-2">
                        {b.market.eventTitle && b.market.groupItemTitle ? `${b.market.eventTitle}: ${b.market.groupItemTitle}` : b.market.question}
                      </Link>
                      {b.rationale && <div className="text-[13px] text-[var(--text-muted)] mt-1 line-clamp-1">{b.rationale}</div>}
                    </td>
                    <td className="px-3 py-3.5"><span className={cn("chip", b.side === "YES" ? "chip-green" : "chip-red")}>{b.side}</span></td>
                    <td className="px-3 py-3.5 mono text-[13px]">${b.sizeUsd.toFixed(0)}<div className="text-[var(--text-dim)]">at {(b.priceAtBet * 100).toFixed(0)}c</div></td>
                    <td className="px-3 py-3.5 text-[13px] text-[var(--text-muted)] hidden sm:table-cell">{fmtIstShort(b.placedAt)}</td>
                    <td className="px-3 py-3.5"><span className={cn("chip", b.status === "won" && "chip-green", b.status === "lost" && "chip-red")}>{b.status}</span></td>
                    <td className="px-3 py-3.5">
                      {b.status === "open" ? (
                        <div className="flex gap-1">
                          <button className="btn btn-ghost btn-sm text-[var(--green)]" onClick={() => resolve(b.id, "won")}>Won</button>
                          <button className="btn btn-ghost btn-sm text-[var(--red)]" onClick={() => resolve(b.id, "lost")}>Lost</button>
                        </div>
                      ) : (
                        <button className="btn btn-ghost btn-sm text-[var(--text-dim)]" onClick={() => remove(b.id)}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: "green" | "red" }) {
  return (
    <div className="card p-4 sm:p-5">
      <div className="text-[12px] text-[var(--text-dim)]">{label}</div>
      <div className={cn("text-[26px] font-bold mt-1 mono tabnum", accent === "green" && "text-[var(--green)]", accent === "red" && "text-[var(--red)]")}>{value}</div>
      {sub && <div className="text-[12px] text-[var(--text-dim)] mt-0.5">{sub}</div>}
    </div>
  );
}

function SignedOut({ title, body }: { title: string; body: string }) {
  return (
    <AppShell>
      <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
        <h1 className="font-display text-[26px] text-[var(--text)] mb-2">{title}</h1>
        <p className="text-[15px] text-[var(--text-muted)] mb-6">{body}</p>
        <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>
      </div>
    </AppShell>
  );
}
