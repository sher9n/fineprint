"use client";

import { Markdown } from "./Markdown";

// The research fields sometimes arrive as the model's raw output with inline labels
// (e.g. "source_findings: ...  steelman: ..."). Split those into clean, titled sub-sections so
// the panel is scannable instead of a wall of text. Falls back to plain markdown when there are
// no recognised labels.
const LABELS: Record<string, string> = {
  source_findings: "What the sources say",
  sources: "What the sources say",
  steelman: "Best case for the other side",
  bottom_line: "Bottom line",
  key_findings: "Key findings",
  verification_steps: "Checks to run",
  reasoning: "Reasoning",
  conclusion: "Conclusion",
  analysis: "Analysis",
  summary: "Summary",
  caveats: "Caveats",
  caveat: "Caveats",
  recommendation: "Recommendation",
  verdict: "Verdict",
};
const KEYS = Object.keys(LABELS);
const RE = new RegExp(`(?:^|\\n)\\s*(${KEYS.join("|")})\\s*:[ \\t]*`, "gi");

export function FindingsView({ content, className }: { content: string; className?: string }) {
  const matches = [...content.matchAll(RE)];
  if (matches.length === 0) return <Markdown content={content} className={className} />;

  const intro = content.slice(0, matches[0].index ?? 0).trim();
  const sections = matches.map((mt, i) => {
    const start = (mt.index ?? 0) + mt[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? content.length) : content.length;
    return { key: mt[1].toLowerCase(), text: content.slice(start, end).trim() };
  });

  return (
    <div className={className}>
      {intro && <div className="mb-4 text-[var(--text-muted)]"><Markdown content={intro} /></div>}
      <div className="space-y-4">
        {sections.map((s, i) => (
          <div key={i}>
            <div className="text-[11px] uppercase tracking-[0.08em] font-bold text-[var(--accent)] mb-1.5">{LABELS[s.key] ?? s.key}</div>
            <Markdown content={s.text} />
          </div>
        ))}
      </div>
    </div>
  );
}
