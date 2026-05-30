"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { OpportunityCard } from "@/components/OpportunityCard";

export default function BookmarksPage() {
  const { data: session } = useSession();
  const { data, isLoading } = useQuery({
    queryKey: ["my-bookmarks"],
    queryFn: async () => {
      const res = await fetch("/api/bookmarks");
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<{
        markets: Array<Parameters<typeof OpportunityCard>[0] & { bookmarkedAt: string; hasObvious?: boolean }>;
        total: number;
      }>;
    },
    enabled: !!session,
    refetchInterval: 60_000,
  });

  if (!session) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
          <h1 className="font-display text-[26px] text-[var(--text)] mb-2">Sign in to save picks</h1>
          <p className="text-[15px] text-[var(--text-muted)] mb-6">Tap the bookmark on any pick to keep it in your own watch list.</p>
          <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  const markets = data?.markets ?? [];

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
        <header className="max-w-2xl mb-8">
          <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.06] tight text-[var(--text)]">Saved picks</h1>
          <p className="text-[16px] text-[var(--text-muted)] mt-3 leading-relaxed">
            Picks you&apos;ve saved to watch. They stay here even if a later scan stops flagging them.
          </p>
        </header>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-80 rounded-[var(--radius-lg)]" />)}
          </div>
        ) : markets.length === 0 ? (
          <div className="card card-pad text-center py-16">
            <div className="font-display text-[20px] text-[var(--text)] mb-2">No saved picks yet</div>
            <p className="text-[15px] text-[var(--text-muted)] max-w-sm mx-auto mb-5">Tap the bookmark on any pick to save it here.</p>
            <Link href="/" className="btn btn-primary">See today&apos;s picks</Link>
          </div>
        ) : (
          <>
            <div className="text-[14px] text-[var(--text-muted)] mb-5">{markets.length} saved</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5 stagger">
              {markets.map((m) => <OpportunityCard key={m.id} {...m} />)}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
