"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useState, type ReactNode, type ComponentType } from "react";
import {
  Home, Bookmark, Heart, Settings, LogOut, LogIn, X, Wrench,
  History, SlidersHorizontal, ChevronDown, User as UserIcon, HelpCircle, Info,
} from "lucide-react";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { AdminActions } from "./AdminActions";
import { Menu as DropdownRoot, MenuLink, MenuButton, MenuSeparator } from "./Dropdown";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [sheetOpen, setSheetOpen] = useState(false);

  const isAdmin = session?.user?.isAdmin;
  const isOnAdmin = path.startsWith("/admin");
  const closeSheet = () => setSheetOpen(false);

  return (
    <div className="min-h-screen flex flex-col bg-[var(--bg)] relative z-[1]">
      {/* ---------- Top bar ---------- */}
      <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg-elev)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-7 min-w-0">
            <Logo size="md" />
            <nav className="hidden md:flex items-center gap-1">
              <TopLink href="/" label="Today's picks" active={path === "/"} />
              <TopLink href="/how-it-works" label="How it works" active={path === "/how-it-works"} />
            </nav>
          </div>

          <div className="flex items-center gap-2.5">
            {isAdmin && isOnAdmin && <div className="hidden lg:block"><AdminActions /></div>}

            {status === "loading" ? (
              <div className="w-9 h-9 rounded-full skeleton" />
            ) : session ? (
              <DropdownRoot
                width={248}
                trigger={
                  <button className="inline-flex items-center gap-1.5 pl-1 pr-2 py-1 rounded-full hover:bg-[var(--bg-overlay)] transition-colors" aria-label="Your account">
                    <Avatar email={session.user.email || ""} />
                    <ChevronDown className="w-4 h-4 text-[var(--text-dim)]" />
                  </button>
                }
              >
                <div className="px-3 py-2.5">
                  <div className="text-[11px] text-[var(--text-dim)]">Signed in as</div>
                  <div className="text-sm text-[var(--text)] truncate font-medium">{session.user.email}</div>
                </div>
                <MenuSeparator />
                <MenuLink href="/bookmarks" icon={<Bookmark className="w-4 h-4" />}>Saved</MenuLink>
                <MenuLink href="/votes" icon={<Heart className="w-4 h-4" />}>My votes</MenuLink>
                <MenuLink href="/settings" icon={<Settings className="w-4 h-4" />}>Settings</MenuLink>
                <MenuSeparator />
                <div className="px-3 py-2 flex items-center justify-between gap-2">
                  <span className="text-sm text-[var(--text-muted)]">Appearance</span>
                  <ThemeToggle compact />
                </div>
                <MenuSeparator />
                <MenuLink href="/how-it-works" icon={<HelpCircle className="w-4 h-4" />}>How it works</MenuLink>
                {isAdmin && (
                  <>
                    <MenuSeparator />
                    <MenuLink href="/admin" icon={<Wrench className="w-4 h-4" />}>Admin overview</MenuLink>
                    <MenuLink href="/admin/runs" icon={<History className="w-4 h-4" />}>Runs</MenuLink>
                    <MenuLink href="/admin/pipeline" icon={<SlidersHorizontal className="w-4 h-4" />}>Pipeline</MenuLink>
                  </>
                )}
                <MenuSeparator />
                <MenuButton onClick={() => signOut({ callbackUrl: "/" })} icon={<LogOut className="w-4 h-4" />} danger>
                  Sign out
                </MenuButton>
              </DropdownRoot>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={() => router.push("/login")}>
                <LogIn className="w-4 h-4" /> Sign in
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 pb-24 md:pb-0">{children}</main>

      {/* ---------- Footer (desktop) ---------- */}
      <footer className="hidden md:block border-t border-[var(--border)] mt-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-7 flex items-center justify-between gap-3">
          <div className="text-[13px] text-[var(--text-dim)] max-w-md">
            We read the fine print on Polymarket so you don&apos;t have to. This is not financial advice.
          </div>
          <div className="flex items-center gap-4 text-[13px] text-[var(--text-dim)]">
            <Link href="/how-it-works" className="hover:text-[var(--text)]">How it works</Link>
            <Link href="/about" className="hover:text-[var(--text)]">About</Link>
          </div>
        </div>
      </footer>

      {/* ---------- Mobile bottom tab bar ---------- */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-[var(--border)] bg-[var(--bg-elev)] pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around h-16">
          <TabItem href="/" label="Picks" icon={Home} active={path === "/"} />
          {session ? (
            <>
              <TabItem href="/bookmarks" label="Saved" icon={Bookmark} active={path.startsWith("/bookmarks")} />
              <TabButton label="Account" icon={UserIcon} active={sheetOpen} onClick={() => setSheetOpen(true)} />
            </>
          ) : (
            <>
              <TabItem href="/how-it-works" label="Guide" icon={HelpCircle} active={path === "/how-it-works"} />
              <TabItem href="/login" label="Sign in" icon={LogIn} active={path === "/login"} />
            </>
          )}
        </div>
      </nav>

      {/* ---------- Mobile account sheet ---------- */}
      {sheetOpen && session && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/45 animate-fade-in" onClick={closeSheet} />
          <div className="absolute inset-x-0 bottom-0 card-elev rounded-b-none rounded-t-[var(--radius-xl)] p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] animate-rise-in">
            <div className="flex items-center justify-between mb-4">
              <div className="min-w-0">
                <div className="text-[11px] text-[var(--text-dim)]">Signed in as</div>
                <div className="text-sm text-[var(--text)] truncate font-medium">{session.user.email}</div>
              </div>
              <button className="p-2 rounded-full hover:bg-[var(--bg-overlay)]" onClick={closeSheet} aria-label="Close">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-1">
              <SheetLink href="/votes" label="My votes" icon={Heart} onClose={closeSheet} />
              <SheetLink href="/settings" label="Settings" icon={Settings} onClose={closeSheet} />
              <SheetLink href="/how-it-works" label="How it works" icon={HelpCircle} onClose={closeSheet} />
              <SheetLink href="/about" label="About" icon={Info} onClose={closeSheet} />
              {isAdmin && (
                <>
                  <div className="pt-3 pb-1 px-3 text-[11px] uppercase tracking-wider text-[var(--text-dim)]">Admin</div>
                  <SheetLink href="/admin" label="Admin overview" icon={Wrench} onClose={closeSheet} />
                  <SheetLink href="/admin/runs" label="Runs" icon={History} onClose={closeSheet} />
                  <SheetLink href="/admin/pipeline" label="Pipeline" icon={SlidersHorizontal} onClose={closeSheet} />
                </>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-[var(--border)] flex items-center justify-between gap-3">
              <ThemeToggle />
              <button className="btn btn-danger" onClick={() => signOut({ callbackUrl: "/" })}>
                <LogOut className="w-4 h-4" /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TopLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        "px-3.5 py-2 rounded-full text-[15px] font-medium transition-colors whitespace-nowrap",
        active ? "bg-[var(--bg-elev-2)] text-[var(--text)]" : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-overlay)]"
      )}
    >
      {label}
    </Link>
  );
}

function TabItem({ href, label, icon: Icon, active }: { href: string; label: string; icon: ComponentType<{ className?: string }>; active: boolean }) {
  return (
    <Link href={href} className={cn("flex-1 flex flex-col items-center justify-center gap-1 transition-colors", active ? "text-[var(--accent)]" : "text-[var(--text-dim)]")}>
      <Icon className="w-[22px] h-[22px]" />
      <span className="text-[11px] font-medium">{label}</span>
    </Link>
  );
}

function TabButton({ label, icon: Icon, active, onClick }: { label: string; icon: ComponentType<{ className?: string }>; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("flex-1 flex flex-col items-center justify-center gap-1 transition-colors", active ? "text-[var(--accent)]" : "text-[var(--text-dim)]")}>
      <Icon className="w-[22px] h-[22px]" />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}

function SheetLink({ href, label, icon: Icon, onClose }: { href: string; label: string; icon: ComponentType<{ className?: string }>; onClose: () => void }) {
  return (
    <Link href={href} onClick={onClose} className="flex items-center gap-3 px-3 py-3 rounded-[var(--radius-md)] text-[15px] text-[var(--text)] hover:bg-[var(--bg-elev-2)] transition-colors">
      <Icon className="w-5 h-5 text-[var(--text-muted)]" />
      {label}
    </Link>
  );
}

function Avatar({ email }: { email: string }) {
  const initial = (email[0] || "?").toUpperCase();
  return (
    <span className="w-9 h-9 rounded-full bg-[var(--accent-soft)] border border-[var(--border)] flex items-center justify-center text-sm font-semibold text-[var(--accent)]">
      {initial}
    </span>
  );
}
