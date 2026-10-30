# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @esp/web...
COPY packages/contracts packages/contracts
COPY packages/ui packages/ui
COPY apps/web apps/web
# The dev sign-in block ships only when the deployment enables dev login (private trial); never in a real production build.
ARG VITE_DEV_LOGIN=false
ENV VITE_DEV_LOGIN=$VITE_DEV_LOGIN
RUN pnpm --filter @esp/contracts build && pnpm --filter @esp/web build

# Unprivileged nginx serving the static bundle; /api is proxied to the api service on the internal network.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null 2>&1 || exit 1
