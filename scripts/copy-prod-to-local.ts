/**
 * Copy the live (Railway) dataset into the LOCAL Postgres for UI testing, via Prisma.
 *
 * Why Prisma and not pg_dump: local Postgres is 17.x while prod is 18.x, so an 18 to 17 restore
 * is unreliable. Copying through Prisma sidesteps the major-version gap, skips the unused
 * embedding vectors, and never writes to prod.
 *
 * Copies active (not closed) markets + their analyses + Settings. Keeps local auth rows
 * (User/Account/Session) so your local sign-in still works. Wipes local domain tables first.
 *
 *   PROD_DBURL="postgresql://...rlwy.net.../railway" npx tsx scripts/copy-prod-to-local.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const localUrl = process.env.DATABASE_URL || "";
const prodUrl = process.env.PROD_DBURL || "";

function assert(cond: boolean, msg: string) { if (!cond) { console.error("ABORT:", msg); process.exit(1); } }
// Hard guards: dest MUST be local, source MUST be the Railway prod DB.
assert(/localhost|127\.0\.0\.1/.test(localUrl), "DATABASE_URL (dest) must be localhost");
assert(/rlwy\.net|railway/i.test(prodUrl), "PROD_DBURL (source) must be the Railway prod DB");

const src = new PrismaClient({ datasources: { db: { url: prodUrl + (prodUrl.includes("?") ? "&" : "?") + "connection_limit=4&pool_timeout=30" } } });
const dst = new PrismaClient({ datasources: { db: { url: localUrl } } });

const PAGE = 1000;
const where = { active: true, closed: false } as const;

async function copyTable(name: string, count: () => Promise<number>, page: (skip: number) => Promise<unknown[]>, insert: (rows: unknown[]) => Promise<unknown>) {
  const total = await count();
  console.log(`${name}: ${total} to copy`);
  let done = 0;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await page(skip);
    if (rows.length === 0) break;
    await insert(rows);
    done += rows.length;
    process.stdout.write(`\r  ${name} ${done}/${total}`);
  }
  if (total > 0) console.log("");
}

async function main() {
  // 1. Wipe local domain tables (FK-safe order). Auth rows are preserved.
  await dst.vote.deleteMany();
  await dst.bookmark.deleteMany();
  await dst.deepResearchJob.deleteMany();
  await dst.analysis.deleteMany();
  await dst.market.deleteMany();
  console.log("wiped local domain tables (kept auth)");

  // 2. Settings
  const settings = await src.settings.findUnique({ where: { id: 1 } });
  if (settings) await dst.settings.upsert({ where: { id: 1 }, update: settings, create: settings });

  // 3. Markets (active, not closed)
  await copyTable(
    "markets",
    () => src.market.count({ where }),
    (skip) => src.market.findMany({ where, orderBy: { id: "asc" }, skip, take: PAGE }),
    (rows) => dst.market.createMany({ data: rows as never, skipDuplicates: true }),
  );

  // 4. Analyses for those markets
  await copyTable(
    "analyses",
    () => src.analysis.count({ where: { market: where } }),
    (skip) => src.analysis.findMany({ where: { market: where }, orderBy: { id: "asc" }, skip, take: PAGE }),
    (rows) => dst.analysis.createMany({ data: rows as never, skipDuplicates: true }),
  );

  const mc = await dst.market.count();
  const ac = await dst.analysis.count();
  console.log(`DONE. local now has markets=${mc} analyses=${ac}`);
  await src.$disconnect();
  await dst.$disconnect();
}

main().catch(async (e) => { console.error("ERR", e.message); await src.$disconnect(); await dst.$disconnect(); process.exit(1); });
