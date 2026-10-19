# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @esp/worker...
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY apps/worker apps/worker
RUN pnpm --filter @esp/contracts build && pnpm --filter @esp/core build && pnpm --filter @esp/worker build \
 && pnpm --filter @esp/worker --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S esp && adduser -S -G esp esp && mkdir -p /data && chown esp:esp /data
WORKDIR /app
COPY --from=build --chown=esp:esp /out /app
USER esp
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
