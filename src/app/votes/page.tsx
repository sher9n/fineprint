"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronUp, ChevronDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";

export default function VotesPage() {
  const { data: session } = useSession();
  const { data } = useQuery({
    queryKey: ["my-votes"],
    queryFn: async () => {
      const res = await fetch("/api/votes");
      return res.json() as Promise<{ votes: Array<{ marketId: string; question: string; eventTitle: string | null; groupItemTitle: string | null; direction: number; createdAt: string }> }>;
    },
    enabled: !!session,
  });

  if (!session) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
          <h1 className="text-xl font-semibold mb-2">Sign in to see your votes</h1>
          <Link href="/login" className="btn btn-primary">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  const votes = data?.votes ?? [];

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Your votes</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Every opportunity you voted on.</p>
        </div>
        {votes.length === 0 ? (
          <div className="card p-12 text-center text-sm text-[var(--text-muted)]">
            You haven't voted yet. Use the up/down arrows on any opportunity to vote.
          </div>
        ) : (
          <div className="space-y-2">
            {votes.map((v) => (
              <Link
                key={v.marketId}
                href={`/markets/${v.marketId}`}
                className="card p-4 flex items-center gap-4 hover:border-[var(--border-strong)]"
              >
                <div className={cn("shrink-0 w-9 h-9 rounded-lg flex items-center justify-center",
                  v.direction > 0 ? "bg-[var(--green-soft)] text-[var(--green)]" : "bg-[var(--red-soft)] text-[var(--red)]"
                )}>
                  {v.direction > 0 ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium line-clamp-1">{v.eventTitle && v.groupItemTitle ? `${v.eventTitle} — ${v.groupItemTitle}` : v.question}</div>
                  <div className="text-xs text-[var(--text-dim)] mt-0.5">{new Date(v.createdAt).toLocaleDateString()}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
