"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SettingsPage() {
  const { data: session } = useSession();

  if (!session) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto px-4 sm:px-6 py-20 text-center">
          <h1 className="font-display text-[26px] text-[var(--text)] mb-2">Sign in to manage settings</h1>
          <Link href="/login" className="btn btn-primary btn-lg">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-5">
        <h1 className="font-display text-[32px] sm:text-[42px] leading-[1.06] tight text-[var(--text)] mb-2">Settings</h1>

        <Section title="Account">
          <Row label="Email">{session.user.email}</Row>
          {session.user.isAdmin && <Row label="Role">Admin</Row>}
        </Section>

        <Section title="Appearance">
          <Row label="Light or dark"><ThemeToggle /></Row>
        </Section>

        <Section title="Notifications">
          <div className="text-[15px] text-[var(--text-muted)]">Email alerts for new strong picks are coming soon.</div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card card-pad">
      <h2 className="font-display text-[18px] text-[var(--text)] mb-3.5">{title}</h2>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="text-[15px] text-[var(--text-muted)]">{label}</div>
      <div className="text-[15px] text-[var(--text)]">{children}</div>
    </div>
  );
}
