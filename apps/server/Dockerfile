ARG NODE_VERSION=26.4.0
FROM node:${NODE_VERSION}-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PNPM_HOME/bin:$PATH
RUN npm install -g corepack@0.35.0 && corepack enable


FROM base AS prepare
# Set working directory
WORKDIR /app
RUN pnpm add -g turbo
COPY . .
RUN turbo prune @feeblo/server --docker

# Add lockfile and package.json's of isolated subworkspace
FROM base AS builder
WORKDIR /app

# First install dependencies (as they change less often)
COPY --from=prepare /app/out/json/ .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=prepare /app/out/full/ .

ENV NODE_ENV=production

# pnpm 11 defaults `verify-deps-before-run` to "install" and does not read it
# from `.npmrc`; turbo passes this env var to a task but the pnpm process that
# decides can miss it, and each task then runs its own concurrent `pnpm
# install` over the same node_modules (publish-images run 37678508391 hung
# with two tasks stuck). Pin it at the image level and keep tasks serial so an
# install can never race another task. `timeout` fails the step in 15 minutes
# instead of burning the 45 minute job timeout.
ENV pnpm_config_verify_deps_before_run=false
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    TURBO_TELEMETRY_DISABLED=1 timeout -k 30 900 ./node_modules/.bin/turbo build --ui=stream --concurrency=1

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ARG APP_RELEASE="dev"
ENV APP_RELEASE="${APP_RELEASE}"

# Pin the app to the port the proxy, healthcheck and compose port mapping
# expect. Without this, a runtime-injected PORT (e.g. 8000) hijacks the
# listen port and the reverse proxy gets connection refused -> 502.
ENV SERVER_PORT=8080
ENV NODE_ENV=production

LABEL org.opencontainers.image.source=https://github.com/g3root/feeblo
LABEL org.opencontainers.image.description="API server of Feeblo — an open-source customer feedback platform"
LABEL org.opencontainers.image.licenses=AGPL-3.0-or-later

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 server
USER server

COPY --from=ghcr.io/tarampampam/microcheck@sha256:c9f79cd408626de7c10f2d487d67339f49adf0ba61dde96ede65343269db1f85 /bin/httpcheck /usr/bin/httpcheck

COPY --from=builder --chown=server:nodejs /app/apps/server/dist ./dist
COPY --from=builder --chown=server:nodejs /app/packages/db/src/migrations ./migrations
COPY --from=builder --chown=server:nodejs /app/packages/db-migrator/dist ./migrate


EXPOSE 8080

CMD ["sh", "-c", "export SERVER_PORT=${SERVER_PORT:-${PORT:-8080}}; node ./migrate/index.js && exec node ./dist/index.js"]


HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD /usr/bin/httpcheck http://localhost:${SERVER_PORT:-8080}/health
