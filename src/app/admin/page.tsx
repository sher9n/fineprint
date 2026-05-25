"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Database, Sparkles, Layers, RefreshCw, History, Wrench, Gauge, Play } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn, fmtUsd } from "@/lib/utils";

export default function AdminHome() {
  const { data: session } = useSession();
  const [running, setRunning] = useState<string | null>(null);

  const { data: budget } = useQuery({
    queryKey: ["budget"],
    queryFn: async () => (await fetch("/api/budget")).json() as Promise<{ spent: number; budget: number; remaining: number; breakdown: Array<{ model: string; purpose: string; costUsd: number }> }>,
    refetchInterval: 8000,
    enabled: !!session?.user?.isAdmin,
  });

  if (!session?.user?.isAdmin) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto px-4 py-12 text-center">
          <h1 className="text-xl font-semibold">Admins only</h1>
          <Link href="/" className="text-sm text-[var(--accent)] hover:underline mt-3 inline-block">Back to opportunities</Link>
        </div>
      </AppShell>
    );
  }

  async function run(kind: "ingest" | "analyze" | "daily" | "poll") {
    setRunning(kind);
    try {
      const url =
        kind === "ingest" ? "/api/ingest" :
        kind === "analyze" ? "/api/analyze" :
        kind === "poll" ? "/api/batch/poll" :
        "/api/cron/run";
      const res = await fetch(url, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || `Failed (${res.status})`);
      else if (data.mode === "batch") toast.success(`Batch submitted: ${data.batchSubmitted ?? data.submitted ?? 0} markets`);
      else toast.success("Done");
    } finally {
      setRunning(null);
    }
  }

  const pct = budget ? Math.min(100, (budget.spent / Math.max(1, budget.budget)) * 100) : 0;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Wrench className="w-5 h-5 text-[var(--text-muted)]" /> Admin
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Manage the analysis pipeline. Only admins see this.</p>
        </div>

        {budget && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-medium">Today's LLM spend</h2>
              <span className="mono text-sm">{fmtUsd(budget.spent)} / {fmtUsd(budget.budget)}</span>
            </div>
            <div className="h-2 bg-[var(--bg-elev-2)] rounded-full overflow-hidden">
              <div className={cn("h-full", pct > 90 ? "bg-[var(--red)]" : pct > 70 ? "bg-[var(--amber)]" : "bg-[var(--green)]")} style={{ width: `${pct}%` }} />
            </div>
            {budget.breakdown.length > 0 && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[var(--text-muted)]">
                {budget.breakdown.map((b, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{b.model.replace("claude-", "")} · {b.purpose}</span>
                    <span className="mono">{fmtUsd(b.costUsd)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <section>
          <h2 className="text-sm font-medium mb-3">Quick actions</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ActionTile
              icon={Database}
              title="Ingest"
              description="Refresh market data. Free."
              cta="Run"
              onClick={() => run("ingest")}
              busy={running === "ingest"}
            />
            <ActionTile
              icon={Sparkles}
              title="Analyze"
              description="LLM pipeline pass."
              cta="Run"
              onClick={() => run("analyze")}
              busy={running === "analyze"}
            />
            <ActionTile
              icon={Layers}
              title="Poll batches"
              description="Check Anthropic batches."
              cta="Poll"
              onClick={() => run("poll")}
              busy={running === "poll"}
            />
            <ActionTile
              icon={RefreshCw}
              title="Run daily"
              description="Full cycle (= 5am cron)."
              cta="Run all"
              onClick={() => run("daily")}
              busy={running === "daily"}
              primary
            />
          </div>
        </section>

        <section>
          <h2 className="text-sm font-medium mb-3">Verify the data</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link href="/admin/runs" className="card p-5 hover:border-[var(--border-strong)] flex items-start gap-3 transition-colors">
              <History className="w-5 h-5 text-[var(--text-muted)] shrink-0" />
              <div>
                <div className="font-medium">Runs history</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">Every ingest, analyze, and batch job with status + cost</div>
              </div>
            </Link>
            <Link href="/admin/calibration" className="card p-5 hover:border-[var(--border-strong)] flex items-start gap-3 transition-colors">
              <Gauge className="w-5 h-5 text-[var(--text-muted)] shrink-0" />
              <div>
                <div className="font-medium">Win rate</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">Bet results, hit rate, calibration by mismatch level</div>
              </div>
            </Link>
            <Link href="/admin/pipeline" className="card p-5 hover:border-[var(--border-strong)] flex items-start gap-3 transition-colors">
              <Wrench className="w-5 h-5 text-[var(--text-muted)] shrink-0" />
              <div>
                <div className="font-medium">Pipeline settings</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">First-pass model, batch mode, budget, filters</div>
              </div>
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function ActionTile({ icon: Icon, title, description, cta, onClick, busy, primary }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; cta?: string; onClick: () => void; busy: boolean; primary?: boolean }) {
  return (
    <div className={cn("card p-3 flex flex-col gap-2.5",
      primary && "border-[var(--accent)] bg-[var(--accent-soft)]/40"
    )}>
      <div className="flex items-center gap-2">
        <div className={cn("shrink-0 w-7 h-7 rounded-lg flex items-center justify-center",
          primary ? "bg-[var(--accent)] text-[var(--accent-fg)]" : "bg-[var(--bg-elev-2)] text-[var(--text-muted)]"
        )}>
          <Icon className={cn("w-3.5 h-3.5", busy && "animate-spin")} />
        </div>
        <div className="text-sm font-medium leading-tight">{title}</div>
      </div>
      <div className="text-[11px] text-[var(--text-muted)] leading-snug min-h-[2.4em]">{description}</div>
      <button
        onClick={onClick}
        disabled={busy}
        className={cn("btn btn-sm w-full justify-center", primary ? "btn-primary" : "")}
      >
        <Play className={cn("w-3 h-3", busy && "animate-pulse")} />
        {busy ? "Running…" : cta || "Run"}
      </button>
    </div>
  );
}

