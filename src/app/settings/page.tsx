"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { Mail, Palette, Bell } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function SettingsPage() {
  const { data: session } = useSession();

  if (!session) {
    return (
      <AppShell>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-12 text-center">
          <h1 className="text-xl font-semibold mb-2">Sign in to manage your settings</h1>
          <Link href="/login" className="btn btn-primary">Sign in</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </div>

        <Section icon={Mail} title="Account">
          <Row label="Email">{session.user.email}</Row>
          {session.user.isAdmin && <Row label="Role">Admin</Row>}
        </Section>

        <Section icon={Palette} title="Appearance">
          <Row label="Theme">
            <ThemeToggle />
          </Row>
        </Section>

        <Section icon={Bell} title="Notifications">
          <div className="text-sm text-[var(--text-muted)]">
            Email notifications for new high-confidence opportunities coming soon.
          </div>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-[var(--text-muted)]" />
        <h2 className="text-sm font-medium">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="text-sm text-[var(--text-muted)]">{label}</div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
