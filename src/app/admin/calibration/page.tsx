"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { Gauge, Sparkles, ChevronUp, ChevronDown } from "lucide-react";

interface CalibrationData {
  totalBets: number;
  resolved: number;
  open: number;
  won: number;
  lost: number;
  winRate: number;
  pnlUsd: number;
  bySide: Array<{ side: string; won: number; lost: number; winRate: number }>;
  byMismatchLevel: Array<{ level: string; won: number; lost: number; winRate: number }>;
  byDivergenceType: Array<{ type: string; won: number; lost: number; winRate: number }>;
  votes: { up: number; down: number; netByEdge: Array<{ band: string; net: number; count: number }> };
}

export default function CalibrationPage() {
  const { data: session } = useSession();
  const { data } = useQuery({
    queryKey: ["calibration"],
    queryFn: async () => (await fetch("/api/calibration")).json() as Promise<CalibrationData>,
    enabled: !!session?.user?.isAdmin,
  });

  if (!session?.user?.isAdmin) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto p-12 text-center">
          <h1 className="text-xl font-semibold">Admins only</h1>
          <Link href="/" className="text-sm text-[var(--accent)] hover:underline mt-3 inline-block">Back to opportunities</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <Link href="/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← Admin</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1 flex items-center gap-2">
            <Gauge className="w-5 h-5 text-[var(--text-muted)]" /> Win rate &amp; calibration
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Track whether our recommendations actually win. Fed by user-logged bets that are marked Won / Lost.
          </p>
        </div>

        {!data ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-24" />)}
          </div>
        ) : data.totalBets === 0 ? (
          <div className="card p-12 text-center">
            <Sparkles className="w-10 h-10 text-[var(--text-dim)] mx-auto mb-3" />
            <h3 className="text-base font-medium mb-1">No resolved bets yet</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
              Once users log bets and mark them as Won or Lost on the bets page, hit rate metrics will appear here.
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="Total bets logged" value={data.totalBets.toString()} />
              <StatCard label="Resolved" value={data.resolved.toString()} sub={`${data.open} still open`} />
              <StatCard
                label="Win rate"
                value={data.resolved > 0 ? `${(data.winRate * 100).toFixed(0)}%` : "—"}
                sub={data.resolved > 0 ? `${data.won}W / ${data.lost}L` : ""}
                accent={data.winRate >= 0.5 ? "green" : data.winRate > 0 ? "red" : undefined}
              />
              <StatCard
                label="Realized PnL"
                value={`$${data.pnlUsd.toFixed(0)}`}
                accent={data.pnlUsd >= 0 ? "green" : "red"}
              />
            </div>

            <Section title="By bet side">
              {data.bySide.map((b) => (
                <BarRow key={b.side} label={`${b.side} bets`} won={b.won} lost={b.lost} winRate={b.winRate} />
              ))}
            </Section>

            <Section title="By mismatch level (the model's divergence call)">
              {data.byMismatchLevel.map((b) => (
                <BarRow key={b.level} label={b.level} won={b.won} lost={b.lost} winRate={b.winRate} />
              ))}
            </Section>

            <Section title="By divergence type">
              {data.byDivergenceType.map((b) => (
                <BarRow key={b.type} label={b.type} won={b.won} lost={b.lost} winRate={b.winRate} />
              ))}
            </Section>

            <Section title="Community votes">
              <div className="flex items-center gap-4 text-sm">
                <span className="inline-flex items-center gap-1.5 text-[var(--green)]"><ChevronUp className="w-4 h-4" /> {data.votes.up} upvotes</span>
                <span className="inline-flex items-center gap-1.5 text-[var(--red)]"><ChevronDown className="w-4 h-4" /> {data.votes.down} downvotes</span>
              </div>
              {data.votes.netByEdge.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {data.votes.netByEdge.map((b) => (
                    <div key={b.band} className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>{b.band}</span>
                      <span className="mono">{b.count} opp · net {b.net >= 0 ? "+" : ""}{b.net}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {data.resolved < 20 && (
              <div className="card p-4 text-xs text-[var(--text-muted)] border-[var(--amber)]/30">
                Hit rates below 20 resolved bets are essentially noise. Keep logging bets to get a reliable signal.
              </div>
            )}
          </>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-medium mb-4">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function BarRow({ label, won, lost, winRate }: { label: string; won: number; lost: number; winRate: number }) {
  const total = won + lost;
  const pct = total > 0 ? winRate * 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-[var(--text)]">{label}</span>
        <span className="mono text-[var(--text-muted)]">
          {won}W / {lost}L · {total > 0 ? `${pct.toFixed(0)}%` : "—"}
        </span>
      </div>
      <div className="h-2 bg-[var(--bg-elev-2)] rounded-full overflow-hidden">
        <div
          className={cn("h-full transition-all", pct >= 50 ? "bg-[var(--green)]" : "bg-[var(--red)]")}
          style={{ width: total > 0 ? `${pct}%` : "0%" }}
        />
      </div>
    </div>
  );
}
