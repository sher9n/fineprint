/**
 * Recompute CostLog.costUsd for every row using the corrected computeCost (no cache_creation,
 * lowered web_search cost). This brings historical accounting in line with what Anthropic
 * Console actually bills.
 *
 * The web_search cost component was previously baked into `costUsd` at logCost time as
 * `extraUsd`. We can't separate it cleanly from the stored value — the stored cost already
 * includes whatever web-search amount was added at write time. For Anthropic verifier rows
 * (which use web_search), we'd need to re-derive the search count; we don't have that stored.
 *
 * Compromise: recompute the token cost from stored columns and ASSUME extraUsd was minor
 * relative to token cost (true for our pricing assumptions — web_search at the corrected
 * $0.0003/call rate is negligible). For models that had non-token extras (verifier with
 * web_search), we'll be slightly under but within noise.
 *
 * Run:
 *   DATABASE_URL='<railway>' npx tsx scripts/backfill-cost-log.ts
 * Pass --dry to preview without writing.
 */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { computeCost } from "../src/lib/budget";

const dry = process.argv.includes("--dry");

async function main() {
  const dbUrl = process.env.DATABASE_URL || "";
  const dbHost = dbUrl.includes("zephyr") ? "Railway prod" : dbUrl.split("@")[1]?.split("/")[0] ?? "unknown";
  console.log(`[backfill] DB: ${dbHost}  mode: ${dry ? "DRY RUN" : "WRITE"}`);

  const total = await prisma.costLog.count();
  console.log(`[backfill] ${total} CostLog rows to recompute`);

  const oldTotalByPurpose = new Map<string, { old: number; n: number }>();
  const newTotalByPurpose = new Map<string, { new: number }>();

  let processed = 0;
  let updated = 0;
  let unchanged = 0;
  // Pull rows by page, compute new cost, then issue ONE bulk UPDATE per page using
  // UPDATE ... FROM (VALUES ...) JOIN. Per-row UPDATE over the public proxy is unacceptably
  // slow (~80ms/req × 15K rows = 20+min); bulk pattern collapses to ~50 queries total.
  const PAGE = 500;

  while (processed < total) {
    const rows = await prisma.costLog.findMany({
      skip: processed,
      take: PAGE,
      orderBy: { id: "asc" },
    });
    if (rows.length === 0) break;

    const changedRows: { id: string; cost: number }[] = [];

    for (const row of rows) {
      const key = `${row.model}/${row.purpose}`;
      const oldEntry = oldTotalByPurpose.get(key) ?? { old: 0, n: 0 };
      oldEntry.old += row.costUsd;
      oldEntry.n += 1;
      oldTotalByPurpose.set(key, oldEntry);

      const newTokenCost = computeCost(row.model, {
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheCreationTokens: row.cacheCreationTokens,
      });

      let discountFactor = 1.0;
      // Matches BATCH_DISCOUNT in src/lib/batch.ts — empirically 75% off, not the documented 50%.
      if (row.purpose.endsWith("_batch")) discountFactor = 0.25;
      const adjusted = newTokenCost * discountFactor;

      const ne = newTotalByPurpose.get(key) ?? { new: 0 };
      ne.new += adjusted;
      newTotalByPurpose.set(key, ne);

      if (Math.abs(adjusted - row.costUsd) > 1e-9) {
        changedRows.push({ id: row.id, cost: adjusted });
      } else {
        unchanged++;
      }
    }

    if (!dry && changedRows.length > 0) {
      const valuesClauses: string[] = [];
      const params: unknown[] = [];
      changedRows.forEach((r, idx) => {
        params.push(r.id);
        params.push(r.cost);
        valuesClauses.push(`($${idx * 2 + 1}, $${idx * 2 + 2}::double precision)`);
      });
      const sql = `
        UPDATE "CostLog" c SET "costUsd" = v.cost
        FROM (VALUES ${valuesClauses.join(",")}) AS v(id, cost)
        WHERE c.id = v.id
      `;
      await prisma.$executeRawUnsafe(sql, ...params);
      updated += changedRows.length;
    }

    processed += rows.length;
    if (processed % 2500 === 0 || processed >= total) {
      console.log(`[backfill] ${processed}/${total} (${updated} updated so far)`);
    }
  }

  console.log(`\n[backfill] DONE: ${processed} processed, ${updated} updated, ${unchanged} unchanged`);
  console.log(`\nPer-purpose summary (old → new):\n`);
  const keys = [...oldTotalByPurpose.keys()].sort();
  let totalOld = 0;
  let totalNew = 0;
  for (const k of keys) {
    const o = oldTotalByPurpose.get(k)!;
    const n = newTotalByPurpose.get(k)!;
    const ratio = n.new > 0 ? o.old / n.new : 0;
    totalOld += o.old;
    totalNew += n.new;
    console.log(`  ${k.padEnd(60)}  n=${String(o.n).padStart(6)}  old=$${o.old.toFixed(2).padStart(9)}  new=$${n.new.toFixed(2).padStart(9)}  ratio=${ratio.toFixed(2)}x`);
  }
  console.log(`  ${"TOTAL".padEnd(60)}  ${"".padStart(8)}      old=$${totalOld.toFixed(2).padStart(9)}  new=$${totalNew.toFixed(2).padStart(9)}  ratio=${(totalOld / Math.max(totalNew, 1e-6)).toFixed(2)}x`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
