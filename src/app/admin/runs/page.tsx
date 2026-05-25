"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, Layers, Sparkles, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { fmtIstShort } from "@/lib/time";
import { cn, fmtUsd } from "@/lib/utils";

interface Run { id: string; kind: string; startedAt: string; finishedAt: string | null; marketsAdded: number; marketsUpdated: number; marketsAnalyzed: number; haikuCalls: number; opusCalls: number; totalCostUsd: number; errors: string | null; status: string }
interface Job { id: string; anthropicBatchId: string; status: string; purpose: string; totalRequests: number; succeededRequests: number; failedRequests: number; costUsd: number; submittedAt: string; endedAt: string | null }
interface DRJob { id: string; marketId: string; marketQuestion: string; openaiResponseId: string; model: string; status: string; costUsd: number; errorMessage: string | null; submittedAt: string; lastPolledAt: string | null; completedAt: string | null }
interface DRJobsResponse { jobs: DRJob[]; budget: { spentToday: number; dailyBudget: number; remaining: number } }

export default function RunsPage() {
  const { data: session } = useSession();
  const [polling, setPolling] = useState(false);
  const { data: runs } = useQuery({ queryKey: ["runs"], queryFn: async () => ((await fetch("/api/runs")).json() as Promise<{ runs: Run[] }>), refetchInterval: 5000, enabled: !!session?.user?.isAdmin });
  const { data: jobs } = useQuery({ queryKey: ["jobs"], queryFn: async () => ((await fetch("/api/batch/jobs")).json() as Promise<{ jobs: Job[] }>), refetchInterval: 5000, enabled: !!session?.user?.isAdmin });
  const { data: drJobs, refetch: refetchDR } = useQuery({ queryKey: ["dr-jobs"], queryFn: async () => ((await fetch("/api/deep-research/jobs")).json() as Promise<DRJobsResponse>), refetchInterval: 30000, enabled: !!session?.user?.isAdmin });

  async function pollNow() {
    setPolling(true);
    const toastId = toast.loading("Polling OpenAI for deep-research job updates...");
    try {
      const r = await fetch("/api/deep-research/poll", { method: "POST" });
      const body = await r.json();
      if (!r.ok || !body.ok) {
        toast.error(body.error || "Poll failed", { id: toastId });
      } else {
        toast.success(`Polled ${body.polled} jobs (${body.completed} completed, ${body.failed} failed, ${body.stillRunning} running)`, { id: toastId });
        refetchDR();
      }
    } finally {
      setPolling(false);
    }
  }

  if (!session?.user?.isAdmin) return <AppShell><div className="p-12 text-center"><h1>Admins only</h1></div></AppShell>;

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <Link href="/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← Admin</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Runs</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">All ingest, analyze, and batch history.</p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--purple)]" /> GPT deep-research jobs
            </h2>
            <div className="flex items-center gap-3">
              {drJobs?.budget && (
                <div className="text-xs text-[var(--text-muted)]">
                  Today: <span className="mono text-[var(--text)]">{fmtUsd(drJobs.budget.spentToday)}</span>
                  <span className="text-[var(--text-dim)]"> / {fmtUsd(drJobs.budget.dailyBudget)}</span>
                </div>
              )}
              <button onClick={pollNow} disabled={polling} className="btn btn-ghost btn-sm">
                <RefreshCw className={cn("w-3.5 h-3.5", polling && "animate-spin")} /> Poll now
              </button>
            </div>
          </div>
          {(drJobs?.jobs ?? []).length === 0 ? (
            <div className="card p-4 text-xs text-[var(--text-muted)]">
              No deep-research jobs yet. Triggered manually from a market&apos;s detail page (only after Opus verification).
            </div>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)]"><th className="text-left font-medium px-4 py-2.5">Submitted</th><th className="text-left font-medium px-3 py-2.5">Market</th><th className="text-left font-medium px-3 py-2.5">Status</th><th className="text-right font-medium px-3 py-2.5">Polled</th><th className="text-right font-medium px-3 py-2.5">Cost</th></tr></thead>
                <tbody>
                  {(drJobs?.jobs ?? []).map((j) => (
                    <tr key={j.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{fmtIstShort(j.submittedAt)}</td>
                      <td className="px-3 py-3 text-xs"><Link href={`/markets/${j.marketId}`} className="hover:text-[var(--accent)] truncate inline-block max-w-[28rem]" title={j.marketQuestion}>{j.marketQuestion}</Link></td>
                      <td className="px-3 py-3"><StatusBadge status={j.status} /></td>
                      <td className="px-3 py-3 text-right text-xs text-[var(--text-dim)]">{j.lastPolledAt ? fmtIstShort(j.lastPolledAt) : "—"}</td>
                      <td className="px-3 py-3 text-right mono text-xs">{j.costUsd > 0 ? fmtUsd(j.costUsd) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {(jobs?.jobs ?? []).length > 0 && (
          <div className="space-y-2">
            <h2 className="text-sm font-medium flex items-center gap-2"><Layers className="w-4 h-4 text-[var(--accent)]" /> Batch jobs</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)]"><th className="text-left font-medium px-4 py-2.5">Submitted</th><th className="text-left font-medium px-3 py-2.5">Status</th><th className="text-right font-medium px-3 py-2.5">Progress</th><th className="text-right font-medium px-3 py-2.5">Cost</th></tr></thead>
                <tbody>
                  {(jobs?.jobs ?? []).map((j) => (
                    <tr key={j.id} className="border-b border-[var(--border)] last:border-b-0">
                      <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{fmtIstShort(j.submittedAt)}</td>
                      <td className="px-3 py-3"><StatusBadge status={j.status} /></td>
                      <td className="px-3 py-3 text-right mono text-xs">{j.succeededRequests}/{j.totalRequests}</td>
                      <td className="px-3 py-3 text-right mono text-xs">{fmtUsd(j.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <h2 className="text-sm font-medium">Ingest + analyze runs</h2>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[10px] uppercase tracking-wider text-[var(--text-dim)] border-b border-[var(--border)]"><th className="text-left font-medium px-4 py-2.5">Started</th><th className="text-left font-medium px-3 py-2.5">Kind</th><th className="text-left font-medium px-3 py-2.5">Status</th><th className="text-right font-medium px-3 py-2.5">Added</th><th className="text-right font-medium px-3 py-2.5">Analyzed</th></tr></thead>
              <tbody>
                {(runs?.runs ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--border)] last:border-b-0">
                    <td className="px-4 py-3 text-xs text-[var(--text-muted)]">{fmtIstShort(r.startedAt)}</td>
                    <td className="px-3 py-3 text-xs"><span className="chip">{r.kind}</span></td>
                    <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-3 py-3 text-right mono text-xs">{r.marketsAdded}</td>
                    <td className="px-3 py-3 text-right mono text-xs">{r.marketsAnalyzed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "success" || status === "ended") return <span className={cn("inline-flex items-center gap-1.5 text-xs text-[var(--green)]")}><CheckCircle2 className="w-3.5 h-3.5" /> {status}</span>;
  if (status === "error") return <span className="inline-flex items-center gap-1.5 text-xs text-[var(--red)]"><XCircle className="w-3.5 h-3.5" /> error</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs text-[var(--accent)]"><Clock className="w-3.5 h-3.5 animate-spin" /> {status}</span>;
}
