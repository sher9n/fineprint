"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Toggle a user's bookmark on a market. Optimistic update with rollback on failure.
 * Visible to signed-in users only; for guests it shows a sign-in toast.
 */
export function BookmarkButton({
  marketId,
  initial,
  size = "md",
  variant = "icon",
}: {
  marketId: string;
  initial: boolean;
  size?: "sm" | "md";
  variant?: "icon" | "labeled";
}) {
  const { data: session } = useSession();
  const [bookmarked, setBookmarked] = useState(initial);
  const [pending, setPending] = useState(false);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!session) {
      toast.error("Sign in to bookmark markets", {
        action: { label: "Sign in", onClick: () => (window.location.href = "/login") },
      });
      return;
    }
    if (pending) return;
    const next = !bookmarked;
    setBookmarked(next);
    setPending(true);
    try {
      const res = await fetch(`/api/markets/${marketId}/bookmark`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookmarked: next }),
      });
      if (!res.ok) throw new Error("save failed");
      toast.success(next ? "Bookmarked" : "Removed from bookmarks", { duration: 1500 });
    } catch {
      setBookmarked(!next);
      toast.error("Could not save your bookmark");
    } finally {
      setPending(false);
    }
  }

  const Icon = bookmarked ? BookmarkCheck : Bookmark;
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const color = bookmarked ? "text-[var(--accent)]" : "text-[var(--text-dim)] hover:text-[var(--text)]";

  if (variant === "labeled") {
    return (
      <button
        onClick={toggle}
        disabled={pending}
        title={bookmarked ? "Remove bookmark" : "Bookmark this market"}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors border",
          bookmarked
            ? "text-[var(--accent)] border-[var(--accent)]/40 bg-[var(--accent-soft)]/40"
            : "text-[var(--text-muted)] border-[var(--border)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
        )}
      >
        <Icon className={iconSize} />
        {bookmarked ? "Bookmarked" : "Bookmark"}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      disabled={pending}
      aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
      title={bookmarked ? "Remove bookmark" : "Bookmark this market"}
      className={cn(
        "p-1 rounded-md transition-colors",
        color,
        bookmarked ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--bg-overlay)]"
      )}
    >
      <Icon className={iconSize} />
    </button>
  );
}
