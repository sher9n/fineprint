import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Bound the connection pool size.
 *
 * Prisma's default pool size is (num_physical_cpus * 2 + 1). On Railway the container reports
 * the host's core count, so a single process opens dozens of Postgres connections. With the
 * web service (and the in-process scheduler running the daily batch) that blew past the managed
 * Postgres `max_connections`, producing "FATAL: sorry, too many clients already" and taking down
 * the 05:00 IST daily run.
 *
 * We cap it to a small, predictable number per process via the `connection_limit` URL param, and
 * raise `pool_timeout` so bursty batch writes queue rather than error. Tune with the
 * `DB_CONNECTION_LIMIT` env var without a code change. Only the runtime DATABASE_URL is affected;
 * DIRECT_URL (used by prisma migrate) keeps its own single short-lived connection.
 */
function pooledUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const limit = process.env.DB_CONNECTION_LIMIT || "5";
  const poolTimeout = process.env.DB_POOL_TIMEOUT || "20";
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("connection_limit")) u.searchParams.set("connection_limit", limit);
    if (!u.searchParams.has("pool_timeout")) u.searchParams.set("pool_timeout", poolTimeout);
    return u.toString();
  } catch {
    if (/[?&]connection_limit=/.test(raw)) return raw;
    return `${raw}${raw.includes("?") ? "&" : "?"}connection_limit=${limit}&pool_timeout=${poolTimeout}`;
  }
}

const url = pooledUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
