import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "./prisma";

const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  pages: {
    signIn: "/login",
    verifyRequest: "/login/check-email",
  },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL || "Fineprint <onboarding@resend.dev>",
      async sendVerificationRequest({ identifier, url, provider }) {
        if (!provider.apiKey) {
          console.log(`\n=== MAGIC LINK (no RESEND_API_KEY set) ===\nTo: ${identifier}\nURL: ${url}\n==========================================\n`);
          return;
        }
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${provider.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: provider.from,
            to: identifier,
            subject: "Sign in to Fineprint",
            html: html({ url, email: identifier }),
            text: text({ url, email: identifier }),
          }),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Resend send failed: ${res.status} ${body}`);
        }
      },
    }),
  ],
  callbacks: {
    async session({ session, user }) {
      // Database strategy spreads the raw Session row (sessionToken, id, userId) and the
      // full User row into `session`. Return only the augmented shape so we don't leak the
      // cookie value or other DB-internal fields via /api/auth/session.
      const isAdmin = adminEmails.includes((user.email || "").toLowerCase()) || (user as { isAdmin?: boolean }).isAdmin === true;
      return {
        user: {
          id: user.id,
          email: user.email ?? null,
          name: user.name ?? null,
          image: user.image ?? null,
          isAdmin,
        },
        expires: session.expires,
      };
    },
    async signIn({ user }) {
      const email = (user.email || "").toLowerCase();
      if (email && adminEmails.includes(email)) {
        await prisma.user.upsert({
          where: { email },
          update: { isAdmin: true },
          create: { email, isAdmin: true },
        });
      }
      return true;
    },
  },
});

function html({ url, email }: { url: string; email: string }) {
  return `<!doctype html>
<html><body style="background:#0a0c10;color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:48px 24px;">
  <div style="max-width:480px;margin:0 auto;background:#111418;border:1px solid #1f2630;border-radius:16px;padding:40px 32px;">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;">
      <div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#4f9eff,#a07cff);"></div>
      <div style="font-weight:600;font-size:18px;">Fineprint</div>
    </div>
    <h1 style="font-size:22px;margin:0 0 12px;">Sign in to Fineprint</h1>
    <p style="color:#8b96a8;font-size:14px;line-height:1.6;margin:0 0 24px;">Click the button below to sign in as <strong style="color:#e6edf3;">${email}</strong>. This link is valid for 24 hours.</p>
    <a href="${url}" style="display:inline-block;background:#4f9eff;color:#0a0c10;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:14px;">Sign in</a>
    <p style="color:#5b6577;font-size:12px;margin:32px 0 0;">If you didn't request this, ignore this email.</p>
  </div>
</body></html>`;
}

function text({ url, email }: { url: string; email: string }) {
  return `Sign in to Fineprint\n\nUser: ${email}\nLink: ${url}\n\nIf you didn't request this, ignore this email.`;
}
