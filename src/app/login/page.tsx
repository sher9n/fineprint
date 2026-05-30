"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Mail, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import Link from "next/link";

// Next.js 16 requires components using useSearchParams to sit under a Suspense boundary.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}

function LoginPageInner() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail.includes("@")) { setError("Please enter a valid email"); return; }
    setBusy(true);
    setError(null);
    try {
      // Dev bypass (local only); /api/dev-login 403s in production and falls through to Resend.
      if (cleanEmail === "sherancorera@gmail.com") {
        const res = await fetch("/api/dev-login", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: cleanEmail }),
        });
        if (res.ok) { window.location.href = callbackUrl; return; }
      }
      await signIn("resend", { email: cleanEmail, callbackUrl, redirect: true });
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] relative z-[1]">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between">
        <Logo size="md" />
        <ThemeToggle compact />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="font-display text-[30px] text-[var(--text)] tight mb-2">Sign in to Fineprint</h1>
          <p className="text-[15px] text-[var(--text-muted)] mb-7">We&apos;ll email you a link to sign in. No password needed.</p>

          <form onSubmit={submit} className="space-y-3">
            <div className="search">
              <Mail className="w-5 h-5 text-[var(--text-dim)] shrink-0" />
              <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" disabled={busy} />
            </div>
            {error && <div className="text-[13px] text-[var(--red)]">{error}</div>}
            <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy}>
              {busy ? "Sending your link..." : <>Email me a sign-in link <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>

          <p className="text-[13px] text-[var(--text-dim)] mt-7 leading-relaxed">
            By signing in you agree to use Fineprint for personal research only. We never place real bets for you.{" "}
            <Link href="/" className="text-[var(--accent)] hover:underline">Back to picks</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
