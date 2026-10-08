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
