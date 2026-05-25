"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Mail, ArrowRight } from "lucide-react";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";
import Link from "next/link";

// Next.js 16 requires components that use useSearchParams to sit under a Suspense boundary,
// otherwise the build refuses to prerender the page.
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
    if (!cleanEmail.includes("@")) {
      setError("Please enter a valid email");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Dev bypass: this email skips the magic link entirely (only works when NODE_ENV !== production)
      if (cleanEmail === "sherancorera@gmail.com") {
        const res = await fetch("/api/dev-login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: cleanEmail }),
        });
        if (res.ok) {
          window.location.href = callbackUrl;
          return;
        }
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Dev login failed");
        setBusy(false);
        return;
      }
      await signIn("resend", { email: cleanEmail, callbackUrl, redirect: true });
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <header className="px-4 sm:px-6 py-4 flex items-center justify-between">
        <Logo size="md" />
        <ThemeToggle compact />
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Sign in to Fineprint</h1>
          <p className="text-sm text-[var(--text-muted)] mb-6">
            We&apos;ll email you a magic link. No passwords.
          </p>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs uppercase tracking-wider text-[var(--text-dim)] mb-1.5">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)] pointer-events-none z-10" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full bg-[var(--bg)] border border-[var(--border-strong)] rounded-lg pl-10 pr-3 py-2.5 text-sm text-[var(--text)] outline-none transition placeholder:text-[var(--text-dim)] focus:border-[var(--accent)]"
                  style={{ ["--tw-ring-color" as string]: "var(--accent-soft)" }}
                  disabled={busy}
                />
              </div>
            </div>
            {error && <div className="text-xs text-[var(--red)]">{error}</div>}
            <button type="submit" className="btn btn-primary w-full" disabled={busy}>
              {busy ? "Sending magic link…" : (
                <>
                  Send magic link <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <p className="text-xs text-[var(--text-dim)] mt-6">
            By signing in you agree to use Fineprint for personal research only. We don&apos;t place real bets on your behalf. <Link href="/" className="text-[var(--accent)] hover:underline">Back to opportunities</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
