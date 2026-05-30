"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import { fmtIstShort } from "@/lib/time";

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
        <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
          <h1 className="font-display text-[26px] text-[var(--text)] mb-2">Sign in to see your feedback</h1>
          <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  const votes = data?.votes ?? [];

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        <header className="max-w-xl">
          <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.06] tight text-[var(--text)]">My feedback</h1>
          <p className="text-[16px] text-[var(--text-muted)] mt-3 leading-relaxed">
            Every pick you rated. Your thumbs up and down help us surface better picks over time.
          </p>
        </header>
        {votes.length === 0 ? (
          <div className="card card-pad text-center py-14">
            <div className="font-display text-[20px] text-[var(--text)] mb-2">No feedback yet</div>
            <p className="text-[15px] text-[var(--text-muted)]">Use &quot;Was this useful?&quot; on any pick to rate it.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {votes.map((v) => (
              <Link key={v.marketId} href={`/markets/${v.marketId}`} className="card lift p-4 flex items-center gap-4">
                <div className={cn("shrink-0 w-10 h-10 rounded-full flex items-center justify-center", v.direction > 0 ? "bg-[var(--green-soft)] text-[var(--green)]" : "bg-[var(--red-soft)] text-[var(--red)]")}>
                  {v.direction > 0 ? <ThumbsUp className="w-5 h-5" /> : <ThumbsDown className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-medium line-clamp-1 text-[var(--text)]">{v.eventTitle && v.groupItemTitle ? `${v.eventTitle}: ${v.groupItemTitle}` : v.question}</div>
                  <div className="text-[13px] text-[var(--text-dim)] mt-0.5">{v.direction > 0 ? "Useful" : "Not useful"} &middot; {fmtIstShort(v.createdAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
