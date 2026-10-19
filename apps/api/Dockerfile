# syntax=docker/dockerfile:1.7
# Multi-stage, non-root, production-only dependencies. Build context = repository root.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @esp/api...
COPY packages/contracts packages/contracts
COPY packages/core packages/core
COPY apps/api apps/api
RUN pnpm --filter @esp/contracts build && pnpm --filter @esp/core build && pnpm --filter @esp/api build \
 && pnpm --filter @esp/api --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S esp && adduser -S -G esp esp && mkdir -p /data && chown esp:esp /data
WORKDIR /app
COPY --from=build --chown=esp:esp /out /app
USER esp
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
