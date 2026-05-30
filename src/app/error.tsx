"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] relative z-[1]">
      <header className="px-4 sm:px-6 py-4">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-5" style={{ background: "var(--amber-soft)", color: "var(--amber)" }}>
            <AlertTriangle className="w-8 h-8" />
          </div>
          <h1 className="font-display text-[30px] text-[var(--text)] tight mb-2">Something went wrong</h1>
          <p className="text-[15px] text-[var(--text-muted)] mb-7">We hit an unexpected error. Try again, or head back to today&apos;s picks.</p>
          <div className="flex items-center justify-center gap-2.5">
            <button className="btn btn-lg" onClick={reset}>Try again</button>
            <Link href="/" className="btn btn-primary btn-lg">Back to picks</Link>
          </div>
          {error.digest && <p className="mt-7 text-[11px] text-[var(--text-dim)] mono">Error ID: {error.digest}</p>}
        </div>
      </main>
    </div>
  );
}
