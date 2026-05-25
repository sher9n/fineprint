"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { toast } from "sonner";
import { Save, Undo2, Zap, Layers, Filter, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { NumberField } from "@/components/NumberField";
import { cn } from "@/lib/utils";

interface Settings {
  autoTradeEnabled: boolean;
  batchModeEnabled: boolean;
  firstPassModel: string;
  haikuConcurrency: number;
  dailyBudgetUsd: number;
  minDivergenceScore: number;
  minLiquidityUsd: number;
  minDaysToEnd: number;
  maxDaysToEnd: number;
}

type DraftKey = "haikuConcurrency" | "dailyBudgetUsd" | "minDivergenceScore" | "minLiquidityUsd" | "minDaysToEnd" | "maxDaysToEnd";
const DRAFT_KEYS: DraftKey[] = ["haikuConcurrency", "dailyBudgetUsd", "minDivergenceScore", "minLiquidityUsd", "minDaysToEnd", "maxDaysToEnd"];

export default function PipelineSettingsPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Partial<Record<DraftKey, number>>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const r = await (await fetch("/api/settings")).json();
    setSettings(r.settings);
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirtyFields = useMemo(() => {
    if (!settings) return [] as DraftKey[];
    return DRAFT_KEYS.filter((k) => draft[k] !== undefined && draft[k] !== settings[k]);
  }, [draft, settings]);

  useEffect(() => {
    if (dirtyFields.length === 0) return;
    function onBefore(e: BeforeUnloadEvent) { e.preventDefault(); e.returnValue = ""; }
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirtyFields.length]);

  if (!session?.user?.isAdmin) return (
    <AppShell><div className="max-w-2xl mx-auto p-12 text-center"><h1 className="text-xl font-semibold">Admins only</h1></div></AppShell>
  );
  if (!settings) return <AppShell><div className="p-8">Loading…</div></AppShell>;

  async function saveToggle(patch: Partial<Settings>) {
    const r = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    const d = await r.json();
    setSettings(d.settings);
    toast.success("Saved");
  }

  async function saveDrafts() {
    if (!settings) return;
    if (dirtyFields.length === 0) return;
    setSaving(true);
    try {
      const patch: Partial<Settings> = {};
      for (const k of dirtyFields) (patch as Record<string, unknown>)[k] = draft[k];
      const r = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const d = await r.json();
      setSettings(d.settings);
      setDraft({});
      toast.success(`Saved ${dirtyFields.length} change${dirtyFields.length === 1 ? "" : "s"}`);
    } finally {
      setSaving(false);
    }
  }

  const value = (k: DraftKey): number => (draft[k] !== undefined ? (draft[k] as number) : (settings as Settings)[k]);
  const isDirty = (k: DraftKey) => dirtyFields.includes(k);

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-28 space-y-5">
        <div>
          <Link href="/admin" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← Admin</Link>
          <h1 className="text-2xl font-semibold tracking-tight mt-1">Pipeline settings</h1>
        </div>

        <ToggleCard
          icon={Sparkles}
          title="First-pass model"
          description="Sonnet 4.6 gives much higher quality but costs ~2.3x Haiku per call."
          value={settings.firstPassModel === "sonnet" ? "Sonnet 4.6" : "Haiku 4.5"}
        >
          <div className="flex items-center gap-1 bg-[var(--bg-elev-2)] rounded-lg p-1 border border-[var(--border)]">
            <button onClick={() => saveToggle({ firstPassModel: "haiku" })} className={cn("px-3 py-1.5 rounded-md text-xs font-medium", settings.firstPassModel === "haiku" ? "bg-[var(--bg-elev)] shadow-sm" : "text-[var(--text-muted)]")}>Haiku 4.5</button>
            <button onClick={() => saveToggle({ firstPassModel: "sonnet" })} className={cn("px-3 py-1.5 rounded-md text-xs font-medium", settings.firstPassModel === "sonnet" ? "bg-[var(--bg-elev)] text-[var(--purple)] shadow-sm" : "text-[var(--text-muted)]")}>Sonnet 4.6</button>
          </div>
        </ToggleCard>

        <ToggleCard
          icon={Layers}
          title="Batch API mode"
          description="When on, Analyze and Run daily submit async batches (~50% cheaper, up to 24h turnaround)."
        >
          <Switch value={settings.batchModeEnabled} onChange={(v) => saveToggle({ batchModeEnabled: v })} />
        </ToggleCard>

        <ToggleCard
          icon={Filter}
          title="Liquidity floor"
          description="Markets below this liquidity are skipped at analyze time. $5k is recommended."
        >
          <div className="w-32"><NumberField value={settings.minLiquidityUsd} step="500" onChange={(v) => saveToggle({ minLiquidityUsd: v })} /></div>
        </ToggleCard>

        <ToggleCard
          icon={Zap}
          title="Auto-bet (placeholder)"
          description="When enabled, the system will (eventually) place real CLOB orders. Currently a flag only."
        >
          <Switch value={settings.autoTradeEnabled} onChange={(v) => saveToggle({ autoTradeEnabled: v })} amber />
        </ToggleCard>

        <div className="card p-5 space-y-3">
          <h2 className="text-sm font-medium">Numeric settings</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Daily LLM budget (USD)" dirty={isDirty("dailyBudgetUsd")}>
              <NumberField value={value("dailyBudgetUsd")} step="1" onChange={(v) => setDraft((d) => ({ ...d, dailyBudgetUsd: v }))} className={cn(isDirty("dailyBudgetUsd") && "border-[var(--accent)]")} />
            </Field>
            <Field label="Concurrent workers (sync mode)" dirty={isDirty("haikuConcurrency")}>
              <NumberField value={value("haikuConcurrency")} min={1} max={10} onChange={(v) => setDraft((d) => ({ ...d, haikuConcurrency: v }))} className={cn(isDirty("haikuConcurrency") && "border-[var(--accent)]")} />
            </Field>
            <Field label="Min divergence to escalate" dirty={isDirty("minDivergenceScore")}>
              <NumberField value={value("minDivergenceScore")} min={0} max={10} onChange={(v) => setDraft((d) => ({ ...d, minDivergenceScore: v }))} className={cn(isDirty("minDivergenceScore") && "border-[var(--accent)]")} />
            </Field>
            <Field label="Min days to resolution" dirty={isDirty("minDaysToEnd")}>
              <NumberField value={value("minDaysToEnd")} onChange={(v) => setDraft((d) => ({ ...d, minDaysToEnd: v }))} className={cn(isDirty("minDaysToEnd") && "border-[var(--accent)]")} />
            </Field>
            <Field label="Max days to resolution" dirty={isDirty("maxDaysToEnd")}>
              <NumberField value={value("maxDaysToEnd")} onChange={(v) => setDraft((d) => ({ ...d, maxDaysToEnd: v }))} className={cn(isDirty("maxDaysToEnd") && "border-[var(--accent)]")} />
            </Field>
          </div>
        </div>
      </div>

      {dirtyFields.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 border-t border-[var(--accent)]/40 bg-[var(--bg-elev)] shadow-lg z-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-[var(--accent)] pulse-dot" />
              {dirtyFields.length} unsaved {dirtyFields.length === 1 ? "change" : "changes"}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-ghost" onClick={() => setDraft({})} disabled={saving}><Undo2 className="w-3.5 h-3.5" /> Discard</button>
              <button className="btn btn-primary" onClick={saveDrafts} disabled={saving}><Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function ToggleCard({ icon: Icon, title, description, value, children }: { icon: React.ComponentType<{ className?: string }>; title: string; description: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="shrink-0 w-10 h-10 rounded-lg bg-[var(--bg-elev-2)] flex items-center justify-center"><Icon className="w-5 h-5 text-[var(--text-muted)]" /></div>
      <div className="flex-1">
        <div className="text-sm font-medium">{title}</div>
        <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md">{description}</p>
        {value && <div className="text-[11px] text-[var(--text-dim)] mt-1 mono">Current: {value}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Switch({ value, onChange, amber }: { value: boolean; onChange: (v: boolean) => void; amber?: boolean }) {
  return (
    <button onClick={() => onChange(!value)} className={cn("relative w-11 h-6 rounded-full transition-colors", value ? (amber ? "bg-[var(--amber)]" : "bg-[var(--accent)]") : "bg-[var(--border-strong)]")}>
      <div className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform", value ? "translate-x-5" : "translate-x-0.5")} />
    </button>
  );
}

function Field({ label, dirty, children }: { label: string; dirty?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider flex items-center gap-1.5">
        <span className={dirty ? "text-[var(--accent)]" : "text-[var(--text-dim)]"}>{label}</span>
        {dirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
