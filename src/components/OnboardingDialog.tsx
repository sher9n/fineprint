"use client";

import { useEffect, useState } from "react";
import { X, BookOpen, Eye, Search, TrendingUp } from "lucide-react";

const STORAGE_KEY = "fineprint_onboarded_v1";

export function OnboardingDialog() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(STORAGE_KEY)) setOpen(true);
  }, []);

  function close() {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  }

  if (!open) return null;

  const steps = [
    {
      icon: BookOpen,
      title: "Welcome to Fineprint",
      body: (
        <>
          <p>On Polymarket, you can bet YES or NO on questions like &quot;Will the Fed cut rates in March?&quot;.</p>
          <p>Each share you buy pays out $1 if you&apos;re right, $0 if you&apos;re wrong. So a share priced at 30¢ means the market thinks there&apos;s a 30% chance.</p>
        </>
      ),
    },
    {
      icon: Eye,
      title: "Most bettors don't read the fine print",
      body: (
        <>
          <p>Every market has detailed resolution rules — the &quot;fine print.&quot; And sometimes those rules say something quite different from what the question implies.</p>
          <p>Example: a market titled &quot;Will Candidate X win the election?&quot; might actually need X to be the certified nominee by a specific date — a much harder bar.</p>
        </>
      ),
    },
    {
      icon: Search,
      title: "We read it for you",
      body: (
        <>
          <p>Every day, Fineprint scans all active Polymarket markets, reads the rules carefully with the help of Claude (Anthropic&apos;s AI), and flags the ones where the rules and the price disagree.</p>
          <p>For the most promising ones, we double-check the facts with a web search.</p>
        </>
      ),
    },
    {
      icon: TrendingUp,
      title: "You decide and bet on Polymarket",
      body: (
        <>
          <p>Each opportunity shows you a clear recommendation: which side to buy, at what price, and what you could win.</p>
          <p>You vote on opportunities, track which ones you bet on, and see how you do over time. We don&apos;t place bets for you — every bet is yours.</p>
        </>
      ),
    },
  ];

  const Step = steps[step];
  const Icon = Step.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 animate-fade-in" onClick={close} />
      <div className="relative w-full max-w-md card-elev p-6 sm:p-8 animate-fade-in">
        <button className="absolute top-3 right-3 p-2 rounded-lg hover:bg-[var(--bg-overlay)]" onClick={close} aria-label="Close">
          <X className="w-4 h-4" />
        </button>

        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
          <Icon className="w-6 h-6" />
        </div>

        <h2 className="text-xl font-semibold tracking-tight mb-3">{Step.title}</h2>

        <div className="space-y-3 text-sm leading-relaxed text-[var(--text-muted)] mb-6">{Step.body}</div>

        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === step ? "w-6 bg-[var(--accent)]" : "w-1.5 bg-[var(--border-strong)]"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={() => setStep(step - 1)}>
                Back
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="btn btn-primary btn-sm" onClick={() => setStep(step + 1)}>
                Next
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={close}>
                Get started
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
