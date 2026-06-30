ARG NODE_VERSION=26.4.0
FROM node:${NODE_VERSION}-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PNPM_HOME/bin:$PATH
RUN corepack enable


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
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=prepare /app/out/full/ .

ENV NODE_ENV=production

RUN pnpm turbo build

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

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 astro
USER astro

COPY --from=builder --chown=astro:nodejs /app/apps/web/dist ./dist

EXPOSE 4321

CMD ["node", "./dist/server/entry.mjs"]
