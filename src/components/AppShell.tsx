"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState, type ReactNode } from "react";
import {
  Compass, Globe, Receipt, Heart, Bookmark, Settings, LogOut, Menu, X, Wrench,
  History, Gauge, SlidersHorizontal, ChevronDown, User as UserIcon, HelpCircle,
} from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { AdminActions } from "./AdminActions";
import { Menu as DropdownRoot, MenuLink, MenuButton, MenuLabel, MenuSeparator } from "./Dropdown";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const isAdmin = session?.user?.isAdmin;
  const isOnAdmin = path.startsWith("/admin");

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-elev)]/85 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          {/* Left: hamburger + logo + primary nav */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              className="md:hidden -ml-1 p-2 rounded-lg hover:bg-[var(--bg-overlay)] shrink-0"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <Logo size="sm" />
            <nav className="hidden md:flex items-center gap-0.5 ml-3">
              <PrimaryLink href="/" label="Opportunities" icon={Compass} active={path === "/"} />
              <PrimaryLink href="/mispricings" label="Mispricings" icon={Globe} active={path === "/mispricings"} />
            </nav>
          </div>

          {/* Right: admin actions, admin menu, theme, user */}
          <div className="flex items-center gap-2">
            {isAdmin && <AdminActions />}

            {isAdmin && (
              <DropdownRoot
                trigger={
                  <button className={cn(
                    "hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm transition-colors",
                    isOnAdmin ? "bg-[var(--bg-elev-2)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
                  )}>
                    <Wrench className="w-4 h-4" />
                    Admin
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>
                }
              >
                <MenuLabel>Admin</MenuLabel>
                <MenuLink href="/admin" icon={<Wrench className="w-4 h-4" />}>Overview</MenuLink>
                <MenuLink href="/admin/runs" icon={<History className="w-4 h-4" />}>Runs</MenuLink>
                <MenuLink href="/admin/calibration" icon={<Gauge className="w-4 h-4" />}>Win rate</MenuLink>
                <MenuLink href="/admin/pipeline" icon={<SlidersHorizontal className="w-4 h-4" />}>Pipeline settings</MenuLink>
              </DropdownRoot>
            )}

            <ThemeToggle compact />

            {status === "loading" ? (
              <div className="w-9 h-9 skeleton" />
            ) : session ? (
              <DropdownRoot
                trigger={
                  <button className="inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)] transition-colors" aria-label="Account menu">
                    <Avatar email={session.user.email || ""} />
                    <ChevronDown className="w-3 h-3 opacity-60" />
                  </button>
                }
                width={240}
              >
                <div className="px-2.5 py-2">
                  <div className="text-xs text-[var(--text-dim)]">Signed in as</div>
                  <div className="text-sm text-[var(--text)] truncate">{session.user.email}</div>
                </div>
                <MenuSeparator />
                <MenuLink href="/bookmarks" icon={<Bookmark className="w-4 h-4" />}>My bookmarks</MenuLink>
                <MenuLink href="/bets" icon={<Receipt className="w-4 h-4" />}>My bets</MenuLink>
                <MenuLink href="/votes" icon={<Heart className="w-4 h-4" />}>My votes</MenuLink>
                <MenuLink href="/settings" icon={<Settings className="w-4 h-4" />}>Settings</MenuLink>
                <MenuSeparator />
                <MenuLink href="/how-it-works" icon={<HelpCircle className="w-4 h-4" />}>How it works</MenuLink>
                <MenuSeparator />
                <MenuButton onClick={() => signOut({ callbackUrl: "/" })} icon={<LogOut className="w-4 h-4" />} danger>
                  Sign out
                </MenuButton>
              </DropdownRoot>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => router.push("/login")}>
                Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={() => setMobileNavOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-72 bg-[var(--bg-elev)] border-r border-[var(--border)] p-4 animate-fade-in flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <Logo size="sm" />
              <button className="p-2 rounded-lg hover:bg-[var(--bg-overlay)]" onClick={() => setMobileNavOpen(false)} aria-label="Close menu">
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="space-y-1 flex-1 overflow-y-auto">
              <MobileLink href="/" label="Opportunities" icon={Compass} active={path === "/"} onClose={() => setMobileNavOpen(false)} />
              <MobileLink href="/mispricings" label="Mispricings" icon={Globe} active={path === "/mispricings"} onClose={() => setMobileNavOpen(false)} />
              {session && (
                <>
                  <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Your account</div>
                  <MobileLink href="/bookmarks" label="My bookmarks" icon={Bookmark} active={path.startsWith("/bookmarks")} onClose={() => setMobileNavOpen(false)} />
                  <MobileLink href="/bets" label="My bets" icon={Receipt} active={path.startsWith("/bets")} onClose={() => setMobileNavOpen(false)} />
                  <MobileLink href="/votes" label="My votes" icon={Heart} active={path.startsWith("/votes")} onClose={() => setMobileNavOpen(false)} />
                  <MobileLink href="/settings" label="Settings" icon={Settings} active={path.startsWith("/settings")} onClose={() => setMobileNavOpen(false)} />
                </>
              )}
              {isAdmin && (
                <>
                  <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Admin</div>
                  <MobileLink href="/admin" label="Admin overview" icon={Wrench} active={path === "/admin"} onClose={() => setMobileNavOpen(false)} />
                  <MobileLink href="/admin/runs" label="Runs" icon={History} active={path.startsWith("/admin/runs")} onClose={() => setMobileNavOpen(false)} />
                  <MobileLink href="/admin/calibration" label="Win rate" icon={Gauge} active={path.startsWith("/admin/calibration")} onClose={() => setMobileNavOpen(false)} />
                  <MobileLink href="/admin/pipeline" label="Pipeline" icon={SlidersHorizontal} active={path.startsWith("/admin/pipeline")} onClose={() => setMobileNavOpen(false)} />
                </>
              )}
              <div className="pt-3 pb-1 px-3 text-[10px] uppercase tracking-wider text-[var(--text-dim)]">Help</div>
              <MobileLink href="/how-it-works" label="How it works" icon={HelpCircle} active={path === "/how-it-works"} onClose={() => setMobileNavOpen(false)} />
              <MobileLink href="/about" label="About" icon={UserIcon} active={path === "/about"} onClose={() => setMobileNavOpen(false)} />
            </nav>
            {session && (
              <div className="pt-3 border-t border-[var(--border)]">
                <div className="px-3 text-xs text-[var(--text-dim)] mb-2 truncate">{session.user.email}</div>
                <button className="btn btn-ghost w-full justify-start" onClick={() => signOut({ callbackUrl: "/" })}>
                  <LogOut className="w-4 h-4" /> Sign out
                </button>
              </div>
            )}
            {!session && (
              <div className="pt-3 border-t border-[var(--border)]">
                <Link href="/login" className="btn btn-primary w-full justify-center" onClick={() => setMobileNavOpen(false)}>
                  Sign in
                </Link>
              </div>
            )}
          </aside>
        </div>
      )}

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--border)] bg-[var(--bg-elev)] mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="text-xs text-[var(--text-dim)]">
            Fineprint reads the fine print on Polymarket so you don&apos;t have to. Not financial advice.
          </div>
          <div className="flex items-center gap-3 text-xs text-[var(--text-dim)]">
            <Link href="/how-it-works" className="hover:text-[var(--text)]">How it works</Link>
            <span>·</span>
            <Link href="/about" className="hover:text-[var(--text)]">About</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function PrimaryLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors whitespace-nowrap",
        active ? "bg-[var(--bg-elev-2)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );
}

function MobileLink({ href, label, icon: Icon, active, onClose }: { href: string; label: string; icon: React.ComponentType<{ className?: string }>; active: boolean; onClose: () => void }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      className={cn(
        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
        active ? "bg-[var(--bg-elev-2)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
      )}
    >
      <Icon className="w-4 h-4" />
      {label}
    </Link>
  );
}

function Avatar({ email }: { email: string }) {
  const initial = (email[0] || "?").toUpperCase();
  return (
    <span className="w-7 h-7 rounded-full bg-[var(--bg-elev-2)] border border-[var(--border)] flex items-center justify-center text-xs font-medium text-[var(--text)]">
      {initial}
    </span>
  );
}
