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
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    refetch();
    qc.invalidateQueries({ queryKey: ["markets"] });
    toast.success(`Marked ${status}`);
  }
  async function remove(id: string) {
    if (!confirm("Delete this bet?")) return;
    await fetch(`/api/bets/${id}`, { method: "DELETE" });
    refetch();
  }

  if (!session) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
          <h1 className="text-xl font-semibold mb-2">Sign in to see your bets</h1>
          <p className="text-sm text-[var(--text-muted)] mb-4">We track every bet you log so you can see your hit rate over time.</p>
          <Link href="/login" className="btn btn-primary">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  const bets = data?.bets ?? [];
  const totals = bets.reduce(
    (a, b) => {
      if (b.status === "open") a.open += b.sizeUsd;
      else if (b.status === "won") { a.won += 1; a.pnl += (b.sizeUsd / b.priceAtBet) - b.sizeUsd; }
      else if (b.status === "lost") { a.lost += 1; a.pnl -= b.sizeUsd; }
      return a;
    },
    { open: 0, won: 0, lost: 0, pnl: 0 }
  );
  const total = totals.won + totals.lost;
  const winRate = total > 0 ? totals.won / total : 0;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your bets</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Bets you've logged on Polymarket. Mark them won/lost when they resolve.</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Open" value={`$${totals.open.toFixed(0)}`} />
          <StatCard label="Wins" value={totals.won.toString()} accent="green" />
          <StatCard label="Losses" value={totals.lost.toString()} accent="red" />
          <StatCard
            label="Win rate"
            value={total > 0 ? `${(winRate * 100).toFixed(0)}%` : "—"}
            sub={total > 0 ? `${total} resolved` : "no data yet"}
            accent={winRate >= 0.5 ? "green" : winRate > 0 ? "red" : undefined}
          />
        </div>

        {bets.length === 0 ? (
          <div className="card p-12 text-center">
            <p className="text-sm text-[var(--text-muted)]">You haven't logged any bets yet. Find an opportunity, then click "Log this bet" on its page.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left font-medium px-4 py-3">Market</th>
                  <th className="text-left font-medium px-3 py-3">Side</th>
                  <th className="text-left font-medium px-3 py-3">Size · price</th>
                  <th className="text-left font-medium px-3 py-3 hidden sm:table-cell">Placed</th>
                  <th className="text-left font-medium px-3 py-3">Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bets.map((b) => (
                  <tr key={b.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-3 max-w-md">
                      <Link href={`/markets/${b.marketId}`} className="hover:text-[var(--accent)] line-clamp-2">
                        {b.market.eventTitle && b.market.groupItemTitle ? `${b.market.eventTitle} — ${b.market.groupItemTitle}` : b.market.question}
                      </Link>
                      {b.rationale && <div className="text-xs text-[var(--text-muted)] mt-1 line-clamp-1">{b.rationale}</div>}
                    </td>
                    <td className="px-3 py-3"><span className={cn("chip text-[10px]", b.side === "YES" ? "chip-green" : "chip-red")}>{b.side}</span></td>
                    <td className="px-3 py-3 mono text-xs">${b.sizeUsd.toFixed(0)}<div className="text-[var(--text-dim)]">@ {(b.priceAtBet * 100).toFixed(0)}¢</div></td>
                    <td className="px-3 py-3 text-xs text-[var(--text-muted)] hidden sm:table-cell">{fmtIstShort(b.placedAt)}</td>
                    <td className="px-3 py-3">
                      <span className={cn("chip text-[10px]",
                        b.status === "won" && "chip-green",
                        b.status === "lost" && "chip-red",
                        b.status === "open" && "chip"
                      )}>{b.status}</span>
                    </td>
                    <td className="px-3 py-3">
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
    <div className="card p-4">
      <div className="text-[10px] uppercase tracking-wider text-[var(--text-dim)]">{label}</div>
      <div className={cn("text-xl font-semibold mt-1 mono", accent === "green" && "text-[var(--green)]", accent === "red" && "text-[var(--red)]")}>{value}</div>
      {sub && <div className="text-xs text-[var(--text-dim)] mt-0.5">{sub}</div>}
    </div>
  );
}
