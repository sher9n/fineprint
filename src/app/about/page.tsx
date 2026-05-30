import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function AboutPage() {
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-6">
        <h1 className="font-display text-[34px] sm:text-[42px] leading-[1.08] tight text-[var(--text)]">About Fineprint</h1>
        <p className="text-[17px] text-[var(--text-muted)] leading-relaxed">
          Fineprint reads the fine print on every active Polymarket market and surfaces the ones where the rules, or the news, quietly point a different way from the price.
        </p>
        <p className="text-[17px] text-[var(--text-muted)] leading-relaxed">
          We use AI to do the heavy lifting: reading the rules carefully, comparing them to what a casual bettor would assume, and double-checking the most promising ones against trusted sources.
        </p>
        <p className="text-[17px] text-[var(--text-muted)] leading-relaxed">
          We don&apos;t place bets and we never touch your money. We&apos;re a research tool that helps you spot bets you&apos;d otherwise miss. You always decide.
        </p>
        <div className="card card-pad text-[15px] text-[var(--text-muted)] leading-relaxed">
          <strong className="text-[var(--text)]">Open source.</strong> You can read the code, run it yourself, or suggest improvements.
        </div>
        <Link href="/" className="btn btn-primary btn-lg">See today&apos;s picks</Link>
      </div>
    </AppShell>
  );
}
