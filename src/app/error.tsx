"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <header className="px-4 sm:px-6 py-4">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="text-6xl mb-4">⚠️</div>
          <h1 className="text-3xl font-semibold tracking-tight mb-2">Something went wrong</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            We hit an unexpected error. Try again, or head back to the opportunities feed.
          </p>
          <div className="flex items-center justify-center gap-2">
            <button className="btn" onClick={reset}>Try again</button>
            <Link href="/" className="btn btn-primary">Back to opportunities</Link>
          </div>
          {error.digest && (
            <p className="mt-6 text-[10px] text-[var(--text-dim)] mono">Error ID: {error.digest}</p>
          )}
        </div>
      </main>
    </div>
  );
}
