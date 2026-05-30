@AGENTS.md

# Fineprint — what this is

Polymarket resolution-rule auditor. Surfaces markets where the **literal rules diverge from the lay reading** of the title in a way casual bettors miss. The user reads the fine print; they decide.

# Architecture

**Four-pass LLM pipeline** (each market can be at any of these stages):

| Pass | Model | Trigger | Cost / call |
|---|---|---|---|
| `haiku` / `sonnet` first-pass | Claude Haiku 4.5 or Sonnet 4.6 (configurable) | Daily batch at 05:00 IST | ~$0.005 |
| `opus` verifier | Claude Opus 4.8 + web search | Auto-escalated when first-pass divergence >= 5 AND edge >= 20 | ~$0.50-1 |
| `gpt_deep` deep research | OpenAI `o3-deep-research` (env `OPENAI_DEEP_RESEARCH_MODEL`) | **Manual only**, admin button per market | ~$1-2 |
| `synthesis` | Claude Opus 4.8 | Auto after `gpt_deep` completes | ~$0.35 |

**Deep research is strictly manual** by user policy. Never auto-trigger it across many markets — it's expensive ($1-2 each) and the user wants explicit consent per call.

**Scheduler** runs daily ingest + first-pass batch + verifier batch at 05:00 IST. Reconciliation against Polymarket Gamma runs each ingest to catch markets that have closed since last sync. Daily run also embeds any newly-ingested markets via `embedPendingMarkets()`.

# Asymmetric specialization: GPT vs Opus

The Opus verifier and GPT deep-research lenses are **deliberately not symmetric**:

- **Opus** is market-aware. Gets sibling-market context (event-siblings, negRisk-siblings, semantic resolved-siblings via pgvector) and is instructed to weight RESOLVER PRECEDENT heavily. Its strength is recognising when textual divergence is NOT actionable mispricing because the crowd or the resolver has already corrected for it.
- **GPT** is market-blind. The fact-finder prompt explicitly forbids citing Polymarket / Kalshi / Manifold / Metaculus / sportsbooks / odds aggregators. Its strength is independent factual world-state from primary sources (named resolution source, government, regulated bodies, primary journalism).
- **Synthesis** sees both outputs + the market price and arbitrates. Has explicit task rules: classify disagreement as FACTUAL (favor GPT) vs STRUCTURAL (favor Opus); weight PRECEDENT over OPTIMISM; apply EXCLUSION-CLAUSE-CHECK symmetrically across recurring-series deadlines.

This is why the architecture is robust: when GPT misses something (e.g. treating negotiation momentum as YES evidence when rules exclude the type of agreement being negotiated), synthesis's EXCLUSION check + Opus's precedent reading catch it.

The key prompt sections to know about are EXCLUSION-CLAUSES, MAP-FACTS-TO-RULE-CATEGORIES, CONSISTENCY-ACROSS-DEADLINES (in `src/lib/deep-research.ts`'s `GPT_FACT_FINDER_SYSTEM_PROMPT`); RESOLVER-PRECEDENT-IS-STRONGEST-SIGNAL, PRECEDENT-OVERRIDES-OPTIMISM (in `src/lib/analyzer.ts`'s `SYSTEM_PROMPT`, shared by Opus and synthesis); WEIGHT-PRECEDENT-OVER-OPTIMISM and EXCLUSION-CLAUSE-CHECK (in the synthesis user prompt in `src/lib/synthesis.ts`).

# Semantic sibling search

`buildMarketContext` (in `src/lib/batch.ts`) used to do keyword OR over question. It now uses cosine similarity on `Market.embedding` via pgvector. Each market is embedded into a 384-dim vector by a **local** sentence-transformer (`Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers`) at ingest time. OpenAI's embedding endpoints are 403'd on this project, hence local.

- Schema: `Market.embedding Unsupported("vector(384)")?` (pgvector extension, see migration `20260527021643_add_market_embedding`)
- The HNSW index was deferred — Railway's managed Postgres OOM'd on the migration's index build with default settings ("could not resize shared memory segment"). Sequential scan over ~70K rows works fine for the current verifier batch workload (one query per analysis). Add the index later with tuned `maintenance_work_mem` + `max_parallel_maintenance_workers=0` when needed.
- Topic text embedded: `eventTitle: groupItemTitle` for grouped markets, else `question`. Description is deliberately excluded (it's largely boilerplate and smears the embedding toward generic resolution-rules language).
- Embeddings are populated by `embedPendingMarkets()` in `src/lib/embeddings.ts`, called from the daily scheduler.

# Critical: LLM_DISABLED kill switch

There are two environments running the same app:
- **Local dev** on `localhost:3001` (Postgres on `localhost:5432`)
- **Railway production** at `https://fineprint-production-a553.up.railway.app` (Railway-managed Postgres)

To prevent double-spending on LLM calls, the env var `LLM_DISABLED` gates all outbound LLM calls (analyzer, batch submitters, deep research, scheduler). Set to `"true"` to refuse calls; unset (or `"false"`) to allow.

**Current state**: local `.env` has `LLM_DISABLED="true"`. Railway does **not** set it (so production runs normally). The user can flip either side by changing env + restarting.

If you (Claude) need to trigger an LLM call for testing locally, flip the env temporarily — but understand the user did this for a reason, and double-check before re-enabling.

# Deployment

- **GitHub**: `git@github.com:sher9n/fineprint.git`, branch `main`
- **Railway**: project `divine-quietude`, services `fineprint` + `Postgres` (Postgres 18.4)
- **Deploy**: push to `main` → Railway auto-rebuilds via the bundled `Dockerfile` → runs `prisma migrate deploy` on boot → starts on `:3000`
- **Verify deploys** by hitting `/api/version` — returns commit SHA from `RAILWAY_GIT_COMMIT_SHA`. The `commit_short` should match what you just pushed.
- **Logs**: `railway logs --service fineprint -d` (or `--json` for parseable output).

# Env vars (set in Railway dashboard; mirror in local `.env`)

- `DATABASE_URL` / `DIRECT_URL` — on Railway, reference `${{Postgres.DATABASE_URL}}` so it tracks the addon.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` — separate budgets for each.
- `AUTH_SECRET` — `openssl rand -base64 32`. Different per environment.
- `AUTH_URL` — production URL. Locally `http://localhost:3001`.
- `RESEND_API_KEY` + `RESEND_FROM_EMAIL` — magic-link sign-in. Empty locally just logs the link to console.
- `ADMIN_EMAILS` — comma-separated. Currently `sheran.corera@docupath.ai,sherancorera@gmail.com`.
- `DAILY_LLM_BUDGET_USD` / `DAILY_DEEP_RESEARCH_BUDGET_USD` — separate caps (Anthropic vs OpenAI).
- `LLM_DISABLED` — see above. Only set locally.

# Auth model

- Auth.js v5 with Prisma adapter, **database session strategy** (cookies are session IDs, not JWTs).
- `/api/dev-login` is dev-only (rejects in production). Hardcoded bypass email: `sherancorera@gmail.com`. Useful for testing without a Resend account.
- Session cookie returned by `/api/auth/session` is **scrubbed** to only `{user: {id, email, name, image, isAdmin}, expires}`. Earlier the database strategy was leaking the raw `sessionToken` into JSON; the session callback in `src/lib/auth.ts` now strips it.
- `RootLayout` wraps `auth()` in try/catch so transient DB issues don't blank every route.

# Where things live

- `src/lib/analyzer.ts` — Haiku/Sonnet first-pass, Opus verifier, `runAnalysisPass`, schema (Zod). Holds the big shared `SYSTEM_PROMPT` (resolver-precedent guidance, exclusion-clauses, etc.).
- `src/lib/batch.ts` — Anthropic batch submitters + pollers. `pickMarketsForBatch`, `pickMarketsForVerifierBatch`. `buildMarketContext` here injects sibling-market context for verifier prompts via pgvector similarity.
- `src/lib/deep-research.ts` — OpenAI Responses API in background mode (we tried batch but the project doesn't have batch model access for `o3-deep-research`; see `inspect-batch.ts`). Holds `GPT_FACT_FINDER_SYSTEM_PROMPT` — deliberately market-blind, forbidden-domains list. `submitDeepResearch` accepts `{ force: true }` for admin re-runs.
- `src/lib/synthesis.ts` — combines latest opus + gpt_deep into a final verdict. Synthesis prompt has explicit FACTUAL-vs-STRUCTURAL disagreement classification and EXCLUSION-CLAUSE-CHECK rules.
- `src/lib/embeddings.ts` — local sentence-transformer (`Xenova/all-MiniLM-L6-v2`), `embedPendingMarkets()`, `findSimilarClosedMarkets()`. The similarity query is a two-step (raw SQL for ids by cosine distance, then Prisma findMany for rows) because `SELECT *` over the pgvector column trips a Prisma deserialize error.
- `src/lib/explain.ts` — plain-English label helpers. `impliedBetSide()` is the helper used everywhere the UI/API asks "which side does this analysis recommend" — derives from `betSide` first, falls back to `rule_p` vs `yesPrice`, only then to raw `edge_direction`. Don't compare raw `edge_direction` for agreement detection.
- `src/lib/llm-gate.ts` — `llmCallsEnabled()` + `LLMDisabledError`.
- `src/lib/scheduler.ts` — daily ingest + batch poll + deep-research poll + embed-pending pass. Honors `LLM_DISABLED`.
- `src/lib/ingest.ts` — Polymarket Gamma ingest + reconciliation. Two upsert paths: `upsertMarket` (fine-grained, returns created/updated/closedFlipped/rulesChanged — used by runIngest and reconcile) and `bulkUpsertMarkets` (single INSERT...ON CONFLICT round-trip — used by the closed-history backfill where the public proxy makes per-row upserts painfully slow).
- `src/lib/polymarket.ts` — Gamma API client. `fetchAllOpenMarkets` paginates `/markets` (offset). `fetchAllClosedMarkets` paginates `/markets/keyset` (cursor) because Gamma 422s on `/markets` past offset 10000. Both have retry-on-transient logic.
- `src/lib/budget.ts` — pricing table + spent / remaining helpers. **Longest-prefix model lookup** so dated snapshots (e.g. `o3-deep-research-2025-06-26`) resolve to the base entry's pricing.
- `src/app/markets/[id]/page.tsx` — the big detail page. Live price + scenario breakdown + agreement banner + side-by-side evidence panels + admin CTAs. Has an admin "Re-run GPT deep-research" button (POSTs with `?force=1`) for prompt-iteration testing.
- `src/app/page.tsx` — homepage with filter bar (Verification filter auto-relaxes Min divergence + Min score when targeting a synthesis variant).
- `scripts/reconcile-closed.ts` — one-off reconciliation runner.
- `scripts/inspect-batch.ts <id>` — dump an OpenAI batch state including the error_file_id contents.
- `scripts/backfill-closed-markets.ts` — one-shot historic-closed-markets backfill via Gamma keyset. Per-page bulk upsert so a mid-run crash doesn't lose work.
- `scripts/backfill-embeddings.ts` — one-shot embedding pass. Idempotent (skips already-embedded rows). Run after the closed-markets backfill or any major schema change.
- `scripts/trigger-deep-research.ts` / `scripts/check-deep-research.ts` — admin utilities. Take market ids on argv; trigger bypasses the HTTP route's session check by calling `submitDeepResearch` directly (use only from a trusted shell).

# Conventions

- Times shown to users are always **IST** (Asia/Kolkata), labelled `'IST'`. DB stores UTC, convert at display time. See `src/lib/time.ts`.
- No em dashes or en dashes in code or copy (project policy).
- LLM JSON output can contain bad escapes (e.g. `\$`); `tryParseJson()` in `analyzer.ts` retries with a backslash-stripping cleaner before giving up.
- `hasThreeWayStructure()` detects markets with 50-50 fallback rules. **Important**: uses `ruleImpliedProbability` vs `expectedYesPayoutCents`, not just sum-of-payouts, since 50-50 fallbacks still sum to ~$1.
- LLM-disabled error UX: return **HTTP 503** with the `LLMDisabledError.message`. Front-end shows it as a toast.
- **Embeddings are local, not OpenAI.** This OpenAI project (`proj_N9q9y3YQNDQ9hB9ipUITL2UD`) is 403'd on `text-embedding-3-*` and `ada-002`; it only has access to `o3-deep-research`. We use `Xenova/all-MiniLM-L6-v2` via `@huggingface/transformers` which runs in-process. If you need higher-quality embeddings, `Xenova/all-mpnet-base-v2` (768 dims) is a drop-in upgrade — but you'd need to also change the `vector(384)` column dimension.
- **Docker base is Debian** (`node:22-slim`), not Alpine. `onnxruntime-node` (used by the embeddings transformer) ships glibc-linked .so files that fail to relocate on Alpine's musl libc.
- **Backfills against prod use bulk INSERT, not per-row upsert.** Railway's public Postgres proxy (`zephyr.proxy.rlwy.net`) has per-request latency around 0.5s; per-row upsert at 100K rows is multi-hour and crashes the connection pool. `bulkUpsertMarkets` in `ingest.ts` collapses each page into one round-trip. Same idea for embeddings: `embedPendingMarkets` uses `UPDATE FROM (VALUES ...)` per batch.
- **Backfills are per-page persistent, never fetch-all-then-upsert.** Long Gamma fetches (60K+ markets, 600+ pages) WILL hit one transient ECONNRESET/500 even with retries. Persisting per-page means a crash leaves partial progress in the DB and a re-run picks up (idempotent upserts), instead of throwing away 65K markets like the first attempt did.
- **`Market.embedding` is `Unsupported("vector(384)")`.** Prisma's findMany skips it automatically (good), but raw `SELECT *` from it fails to deserialize (bad). When you need the vector for similarity search, use the two-step pattern in `findSimilarClosedMarkets`: raw SQL for ids, Prisma findMany for rows.
- **Agreement detection uses `impliedBetSide`, not raw `edge_direction`.** The schema's `edge_direction` answers "which side does the LITERAL reading favor over the VIBE reading" — a divergence-direction, not a bet-direction. A fact-finder that sees no rules-vs-vibe gap but estimates P(YES)=1.0 against 49¢ returns `edge_direction=NONE` while implicitly recommending YES. See `src/lib/explain.ts:impliedBetSide`.

# Recent significant work (the build that made it a real app)

This whole codebase started from `create-next-app` boilerplate. In one session we built:

1. **Multi-pass pipeline** — first-pass (Haiku/Sonnet) auto-escalating to Opus verifier; manual GPT deep-research → Opus synthesis.
2. **Live price + scenarios** — `/api/markets/[id]/live-price` hits Gamma with 30s server cache, recomputes EV against live price, switches recommendation to an "Edge has evaporated" amber state when EV flips negative. Three-way scenario breakdown for fallback markets.
3. **Verification UX** — `verifyStage` exposed via `/api/markets`, badge component (`VerifyStageBadge`), accent border on cards/rows, dedicated filter that auto-relaxes score/divergence when picking a synthesis variant (since synthesis prompt deliberately downgrades divergence on disagreement).
4. **Markdown rendering** — GPT's source-findings is full of inline citations like `[apnews.com](https://...)`; `src/components/Markdown.tsx` renders them cleanly with `react-markdown` + `remark-gfm` + `remark-breaks`.
5. **Ingest reconciliation** — Polymarket drops closed markets from active pages; `reconcileStaleMarkets` re-checks every DB market not seen in the latest sweep so stale "still open" records get corrected.
6. **Production deploy + DB replication** — Railway via Dockerfile + railway.toml. Local DB was dumped to Railway so expensive batch outputs aren't lost when iterating.
7. **`LLM_DISABLED` kill switch** — added when running local + Railway in parallel risked double-spending.
8. **GPT-as-independent-fact-finder split** — old GPT prompt was market-aware (saw Polymarket rules page, sibling resolutions, anchored on the market price). New `GPT_FACT_FINDER_SYSTEM_PROMPT` is market-blind with a forbidden-domains list. Opus stays market-aware on its own branch; synthesis sees both and arbitrates. The asymmetry was the design goal: independent factual lens + market-structural lens → final verdict.
9. **EXCLUSION-clauses + MAP-FACTS-TO-RULE-CATEGORIES** — added after the Iran-by-May-31 market (1919425) revealed GPT was inflating rule_p by treating negotiation momentum as YES evidence when the rules explicitly excluded "temporary ceasefire extension / 60-day MOU." Synthesis prompt got the same defense as a second-layer check. Validated by re-running 5 markets: 4/5 produced meaningfully better verdicts; the unchanged one (Abraham Accords, 665427) was unchanged for the right reason — Kazakhstan officially joined the Accords on Nov 6 2025, which the system correctly identified as the qualifying event despite the bearish base rate.
10. **pgvector semantic sibling search + 60K-market historical backfill** — replaced keyword-OR matching (which got dominated by common words like "United" pulling sports markets) with cosine similarity on a 384-dim local-sentence-transformer embedding. Backfilled 60,400 historic closed Polymarket markets into prod for resolver-precedent reasoning; all 70,805 prod markets embedded.

# Things you should NOT do without asking

- Trigger deep research auto-pipeline across many markets. Always per-market, admin-clicked.
- Re-enable LLM calls locally without confirming with the user first.
- Touch the production Railway env vars or push without explicit OK.
- Add backwards-compat shims when removing code — delete unused stuff cleanly.
- Reach for OpenAI embeddings — the project key is 403'd on `text-embedding-*` and `ada-002`. Use the local `Xenova/all-MiniLM-L6-v2` pipeline in `src/lib/embeddings.ts`.
- Fetch-all-then-upsert in long backfills against the public Railway proxy. Always per-page persistent so a transient error doesn't throw away 60K rows of work.
- Compare raw `edge_direction` for agreement detection. Use `impliedBetSide` (`src/lib/explain.ts`) — the schema's `edge_direction` is a divergence-direction, not a bet-direction.

# Things you SHOULD do

- After pushing a commit, verify with `curl https://fineprint-production-a553.up.railway.app/api/version` that the new `commit_short` matches before declaring done.
- Test end-to-end after changes (the user explicitly wants this).
- Discuss approach before implementing for non-trivial work.
