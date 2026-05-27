# Debian-slim base instead of alpine: @huggingface/transformers ships onnxruntime-node which
# requires glibc-linked .so files; alpine's musl libc fails at runtime with "Error relocating
# libonnxruntime.so.1: __vsnprintf_chk: symbol not found". Bookworm-slim is ~100MB larger but
# everything links cleanly.
FROM node:22-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Replace the standalone's pruned node_modules with the full builder tree. Standalone strips out
# anything not reachable from server.js, but `prisma migrate deploy` at boot needs its full
# dependency graph (including transitive deps like `effect` via @prisma/config). The image grows,
# but build reliability is worth it. Order matters: this overlays on top of standalone's output.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Invoke prisma's CLI directly. The `.bin/prisma` symlink isn't preserved across docker
# COPY stages, so `npx prisma` fails with "prisma: not found" at runtime — call the underlying
# build artifact instead, which is guaranteed to be where we copied it.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
