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
RUN turbo prune @feeblo/web --docker

# Add lockfile and package.json's of isolated subworkspace
FROM base AS builder
WORKDIR /app

# First install dependencies (as they change less often)
COPY --from=prepare /app/out/json/ .
RUN echo "node-linker=hoisted" > .npmrc
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=prepare /app/out/full/ .

# `turbo prune` only copies workspace packages into out/full, so the
# root-level paraglide project and message catalogs have to be copied
# explicitly or `build:paraglide` fails with ENOENT.
COPY --from=prepare /app/project.inlang ./project.inlang
COPY --from=prepare /app/messages ./messages

ENV NODE_ENV=production

# `pnpm turbo` re-verifies and reinstalls before running the command, the
# turbo CLI shim silently falls back to `npm install` when its native
# `@turbo/*` binary is missing, and the TUI writes nothing to a non-TTY log.
# Each can hang the build with no output (publish-images run 37678508391 sat
# 45 minutes). Run the local binary directly, against the `out/json` install
# that already happened, and bound the step so a stall fails in 15 minutes
# instead of 45.
RUN echo "verify-deps-before-run=false" >> .npmrc
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    TURBO_TELEMETRY_DISABLED=1 timeout -k 30 900 ./node_modules/.bin/turbo build --ui=stream

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app


ARG APP_RELEASE="dev"
ARG APP_URL=""
ARG API_URL=""
ARG APP_ROOT_DOMAIN=""

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV APP_RELEASE="${APP_RELEASE}"
ENV APP_URL="${APP_URL}"
ENV API_URL="${API_URL}"
ENV APP_ROOT_DOMAIN="${APP_ROOT_DOMAIN}"
ENV CLOUDFLARE_ADAPTER=false

LABEL org.opencontainers.image.source=https://github.com/g3root/feeblo
LABEL org.opencontainers.image.description="Web server of Feeblo — an open-source customer feedback platform"
LABEL org.opencontainers.image.licenses=AGPL-3.0-or-later

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 astro
USER astro

COPY --from=builder --chown=astro:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=astro:nodejs /app/apps/web/dist ./dist
COPY --from=builder --chown=astro:nodejs /app/apps/web/server.mjs ./server.mjs

EXPOSE 4321

CMD ["node", "./server.mjs"]
