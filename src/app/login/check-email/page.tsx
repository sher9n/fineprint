import Link from "next/link";
import { Mail } from "lucide-react";
import { Logo } from "@/components/Logo";

export default function CheckEmailPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <header className="px-4 sm:px-6 py-4">
        <Logo size="md" />
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
            <Mail className="w-7 h-7" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight mb-2">Check your email</h1>
          <p className="text-sm text-[var(--text-muted)]">
            We sent a magic link to sign you in. Click the link in the email to continue. You can close this tab.
          </p>
          <p className="text-xs text-[var(--text-dim)] mt-6">
            If you don&apos;t see it, check spam. <Link href="/login" className="text-[var(--accent)] hover:underline">Try a different email</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
