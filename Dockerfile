# Multi-stage single-process container for Minimal Sanguosha Online PvP
FROM node:22-slim AS builder

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/

RUN pnpm install --frozen-lockfile

COPY packages/engine packages/engine
COPY packages/web packages/web
COPY packages/server packages/server

RUN pnpm build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# Install only ws runtime dependency (all TS engine/server code is pre-bundled into dist/server.mjs)
RUN npm init -y >/dev/null 2>&1 && npm install --omit=dev ws@8.18.0 && rm -f package.json package-lock.json

COPY --from=builder /app/packages/web/dist ./packages/web/dist
COPY --from=builder /app/packages/server/dist/server.mjs ./packages/server/dist/server.mjs

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "packages/server/dist/server.mjs"]
