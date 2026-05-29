"use client";

import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
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
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
          <Bookmark className="w-10 h-10 text-[var(--text-dim)] mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">Sign in to see your bookmarks</h1>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
            Bookmark markets you want to keep an eye on — they'll show up here in a personal watch list.
          </p>
          <Link href="/login" className="btn btn-primary">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  const markets = data?.markets ?? [];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Your bookmarks</h1>
          <p className="text-sm sm:text-base text-[var(--text-muted)] mt-1.5 max-w-2xl">
            Markets you've saved to watch. They stay here even if the daily run later decides they're no longer a flagged opportunity — your bookmark wins.
          </p>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-72" />)}
          </div>
        ) : markets.length === 0 ? (
          <div className="card p-10 sm:p-16 text-center">
            <Bookmark className="w-10 h-10 text-[var(--text-dim)] mx-auto mb-4" />
            <h3 className="text-lg font-medium mb-1">No bookmarks yet</h3>
            <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-4">
              On any market card or detail page, click the bookmark icon to save it here.
            </p>
            <Link href="/" className="btn btn-primary">Browse opportunities</Link>
          </div>
        ) : (
          <>
            <div className="text-xs text-[var(--text-dim)] mb-3">
              {markets.length} {markets.length === 1 ? "market" : "markets"} bookmarked
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
              {markets.map((m) => (
                <OpportunityCard key={m.id} {...m} bookmarked={true} />
              ))}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
