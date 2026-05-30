import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { Search, FileSearch, Newspaper, MessageSquare, Hand } from "lucide-react";

export default function HowItWorksPage() {
  const steps = [
    {
      icon: Search,
      title: "We scan every Polymarket market, every day",
      body: "There are thousands of live bets at any moment. We pull every one and keep the full rules, the current price, and how much money is in play.",
    },
    {
      icon: FileSearch,
      title: "We read the fine print",
      body: "For each market, an AI compares the question to the actual resolution rules. Do they say the same thing, or do the rules add a deadline, a source, or a threshold that quietly changes the answer?",
    },
    {
      icon: Newspaper,
      title: "We double-check the best ones against the news",
      body: "When something looks promising, a second review checks the facts against trusted sources. This catches markets where the real world has already moved but the price hasn't.",
    },
    {
      icon: MessageSquare,
      title: "You get a plain-English pick",
      body: "Every pick tells you what to buy, what it costs, what you could win, and why, with no jargon. A simple strength label tells you how confident we are.",
    },
    {
      icon: Hand,
      title: "You place the bet. You stay in control.",
      body: "We never place bets for you. You open Polymarket and place it yourself. Every bet is yours.",
    },
  ];

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 sm:py-14 space-y-10">
        <div>
          <h1 className="font-display text-[34px] sm:text-[42px] leading-[1.08] tight text-[var(--text)]">How Fineprint works</h1>
          <p className="text-[17px] text-[var(--text-muted)] mt-3 leading-relaxed">
            We do the boring work of reading every market&apos;s fine print, so you can spot the bets where the crowd is probably wrong.
          </p>
        </div>

        <div className="space-y-7">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <div key={i} className="flex gap-4">
                <div className="shrink-0 flex flex-col items-center">
                  <div className="w-11 h-11 rounded-2xl flex items-center justify-center" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {i < steps.length - 1 && <div className="w-px flex-1 bg-[var(--border)] mt-2" />}
                </div>
                <div className="flex-1 pb-2">
                  <h2 className="font-display text-[19px] sm:text-[20px] text-[var(--text)]">{s.title}</h2>
                  <p className="text-[15px] text-[var(--text-muted)] mt-1.5 leading-relaxed">{s.body}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card card-pad">
          <h3 className="font-display text-[18px] text-[var(--text)] mb-2.5">A few honest words</h3>
          <ul className="text-[15px] text-[var(--text-muted)] space-y-2 leading-relaxed">
            <li>Our analysis is AI-generated and can be wrong. Always check the rules and the latest facts before betting.</li>
            <li>Polymarket is real money. Only bet what you can afford to lose.</li>
            <li>The upside we show assumes our read is right. It usually is, roughly. Sometimes it isn&apos;t.</li>
            <li>Tell us if a pick was useful. Your feedback makes the picks better over time.</li>
          </ul>
        </div>

        <div>
          <Link href="/" className="btn btn-primary btn-lg">See today&apos;s picks</Link>
        </div>
      </div>
    </AppShell>
  );
}
