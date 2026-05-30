"use client";

import { useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Hint } from "./Hint";
import { opportunityScoreLabel } from "@/lib/explain";

const SCORE_COLOR: Record<string, string> = {
  green: "var(--green)", amber: "var(--amber)", accent: "var(--accent)", muted: "var(--text-muted)",
};
// Intensity ramp for the mismatch (hotter = bigger gap = more eye-catching).
function mismatchColor(s: number): string {
  return s >= 8 ? "var(--red)" : s >= 6 ? "var(--amber)" : s >= 4 ? "var(--accent)" : "var(--text-dim)";
}

/** A bold, color-coded "LABEL n/10" chip, hoverable for the full explanation. */
function Stat({ label, value, color, title, body, width }: { label: string; value: number; color: string; title: string; body: ReactNode; width?: number }) {
  return (
    <Hint title={title} body={body} width={width}>
      <span className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-[var(--radius-md)] border border-[var(--border-strong)] bg-[var(--bg-elev-2)]">
        <span className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-dim)] font-semibold">{label}</span>
        <span className="mono font-bold text-[16px] leading-none" style={{ color }}>
          {value}<span className="text-[11px] text-[var(--text-dim)] font-medium">/10</span>
        </span>
        <Info className="w-3 h-3 text-[var(--text-dim)] opacity-70 shrink-0" />
      </span>
    </Hint>
  );
}

export function MismatchStat({ score, isMispricing, vibe, literal }: { score: number; isMispricing: boolean; vibe: string; literal: string }) {
  return (
    <Stat
      label="Mismatch"
      value={score}
      color={mismatchColor(score)}
      width={344}
      title={isMispricing ? "Why the price looks wrong" : "Why it's a mismatch"}
      body={
        <>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-dim)] font-semibold mb-1">
              {isMispricing ? "What the price implies" : "What people assume"}
            </div>
            <p className="text-[var(--text)]">{vibe}</p>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-[0.06em] font-semibold mb-1" style={{ color: "var(--amber)" }}>
              {isMispricing ? "What the news actually shows" : "What actually counts"}
            </div>
            <p className="text-[var(--text)]">{literal}</p>
          </div>
        </>
      }
    />
  );
}

const timeFactor = (endDate: string | Date | null, now: number): number => {
  if (!endDate) return 0.5;
  const days = (new Date(endDate).getTime() - now) / 86_400_000;
  if (days < 1) return 0;
  if (days <= 30) return 1;
  if (days <= 90) return 0.8;
  if (days <= 180) return 0.5;
  return 0.3;
};

export function ScoreStat(p: {
  edgeScore: number;
  divergenceScore: number;
  priceGap: number | null;
  liquidity: number;
  endDate: string | null;
  pass: string;
  directionAgreement: boolean;
}) {
  const [now] = useState(() => Date.now());
  const score10 = Math.round(p.edgeScore / 10);
  const color = SCORE_COLOR[opportunityScoreLabel(p.edgeScore).color] ?? "var(--text)";
  const gap = p.priceGap ?? 0;
  const div = p.divergenceScore / 10;
  const liq = Math.max(0, Math.min(1, Math.log10(Math.max(1, p.liquidity)) / 5));
  const time = timeFactor(p.endDate, now);
  const passWeight = p.pass === "opus" || p.pass === "synthesis" || p.pass === "obvious" ? 1.0 : 0.85;
  const directionMult = p.directionAgreement !== false ? 1.0 : 0.6;
  const c = { gap: gap * 5, div: div * 3, liq: liq * 1, time: time * 1 }; // contributions on a 0-10 scale
  const rawTotal = c.gap + c.div + c.liq + c.time;
  const days = p.endDate ? Math.max(0, (new Date(p.endDate).getTime() - now) / 86_400_000) : null;

  return (
    <Stat
      label="Score"
      value={score10}
      color={color}
      width={332}
      title="How this score is calculated"
      body={
        <>
          <p>Our overall read blends four signals into a 0-10 number. Bigger is better.</p>
          <div className="space-y-2.5">
            <Factor label="Price gap" detail={p.priceGap != null ? `${(gap * 100).toFixed(1)}pp` : "-"} weight="50%" value={gap} contribution={c.gap} note="How much the price disagrees with our rules-based estimate" />
            <Factor label="Mismatch" detail={`${p.divergenceScore}/10`} weight="30%" value={div} contribution={c.div} note="How big the gap is between the rules and what bettors assume" />
            <Factor label="Liquidity" detail={`$${(p.liquidity / 1000).toFixed(0)}k`} weight="10%" value={liq} contribution={c.liq} note="How much money is in the market" />
            <Factor label="Time to resolve" detail={days != null ? (days < 1 ? "<1d" : days < 60 ? `${Math.round(days)}d` : `${Math.round(days / 30)}mo`) : "-"} weight="10%" value={time} contribution={c.time} note="Sooner resolution means more confidence, sooner payout" />
          </div>
          <div className="pt-2 border-t border-[var(--border)] space-y-1">
            <Row label="Raw total" value={rawTotal.toFixed(1)} />
            {passWeight === 1 && (p.pass === "opus" || p.pass === "synthesis") && <Row label="Confirmed by web search" value="x 1.0" tone="green" />}
            {passWeight < 1 && <Row label="First look, not web-checked yet" value="x 0.85" tone="muted" />}
            {directionMult < 1 && <Row label="Models and math differ on side" value="x 0.6" tone="amber" />}
            <div className="flex justify-between text-[12.5px] font-semibold pt-1 border-t border-[var(--border)]">
              <span className="text-[var(--text)]">Final score</span>
              <span className="mono text-[var(--text)]">{score10} / 10</span>
            </div>
          </div>
        </>
      }
    />
  );
}

function Factor({ label, detail, weight, value, contribution, note }: { label: string; detail: string; weight: string; value: number; contribution: number; note: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[12px]">
        <span className="text-[var(--text)] font-medium">{label}</span>
        <span className="text-[var(--text-muted)] mono">{detail}</span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <span className="flex-1 h-1.5 bg-[var(--bg-elev-2)] rounded-full overflow-hidden">
          <span className="block h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
        </span>
        <span className="text-[10.5px] text-[var(--text-dim)] mono w-9 text-right">+{contribution.toFixed(1)}</span>
        <span className="text-[10.5px] text-[var(--text-dim)] w-8 text-right">({weight})</span>
      </div>
      <div className="text-[10.5px] text-[var(--text-dim)] mt-0.5 leading-snug">{note}</div>
    </div>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "green" | "amber" | "muted" }) {
  const c = tone === "green" ? "text-[var(--green)]" : tone === "amber" ? "text-[var(--amber)]" : "text-[var(--text-muted)]";
  return (
    <div className={`flex justify-between text-[11.5px] ${c}`}>
      <span>{label}</span>
      <span className="mono">{value}</span>
    </div>
  );
}
