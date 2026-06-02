"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { cn, fmtUsd } from "@/lib/utils";

interface BudgetInfo {
  spent: number;
  budget: number;
  remaining: number;
}

export function AdminActions() {
  const [budget, setBudget] = useState<BudgetInfo | null>(null);

  async function load() {
    try {
      const b = await fetch("/api/budget").then((r) => r.json());
      setBudget({ spent: b.spent, budget: b.budget, remaining: b.remaining });
    } catch {}
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const pct = budget && budget.budget > 0 ? Math.min(100, (budget.spent / budget.budget) * 100) : 0;
  const overBudget = budget && budget.remaining <= 0.5;

  return (
    <div className="hidden lg:flex items-center gap-2.5 px-3 mr-1 border-r border-[var(--border)]">
      <Link href="/admin" className="flex items-center gap-2 hover:opacity-80 transition-opacity" title="LLM budget today (IST). Click to open admin.">
        <div className={cn("w-1.5 h-1.5 rounded-full", overBudget ? "bg-[var(--red)]" : "bg-[var(--green)]", "pulse-dot")} />
        <span className="text-[11px] text-[var(--text-muted)] mono whitespace-nowrap">
          <span className="text-[var(--text)]">{fmtUsd(budget?.spent)}</span>
          <span className="text-[var(--text-dim)]"> / {fmtUsd(budget?.budget)}</span>
        </span>
        <div className="w-12 h-1 bg-[var(--bg-elev-2)] rounded-full overflow-hidden">
          <div
            className={cn("h-full transition-all", overBudget ? "bg-[var(--red)]" : pct > 70 ? "bg-[var(--amber)]" : "bg-[var(--green)]")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </Link>

      {overBudget && (
        <span className="chip text-[10px]" style={{ color: "var(--red)", borderColor: "transparent", background: "var(--red-soft)" }} title="LLM budget exhausted for today (IST)">
          <AlertTriangle className="w-3 h-3" /> over budget
        </span>
      )}
    </div>
  );
}
