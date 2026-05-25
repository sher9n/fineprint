import { auth } from "./auth";

export async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; reason: string; status: number }> {
  const session = await auth();
  if (!session?.user) return { ok: false, reason: "auth required", status: 401 };
  if (!session.user.isAdmin) return { ok: false, reason: "admin only", status: 403 };
  return { ok: true, userId: session.user.id! };
}
