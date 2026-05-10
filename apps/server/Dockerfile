ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PNPM_HOME/bin:$PATH
RUN corepack enable


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

RUN pnpm turbo build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ARG APP_RELEASE="dev"
ARG APP_URL=""
ARG API_URL=""

ENV NODE_ENV=production
ENV SERVER_PORT=8080
ENV APP_RELEASE="${APP_RELEASE}"
ENV APP_URL="${APP_URL}"
ENV API_URL="${API_URL}"

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 server
USER server


COPY --from=builder --chown=server:nodejs /app/apps/server/dist ./dist
COPY --from=builder --chown=server:nodejs /app/packages/db/src/migrations ./migrations
COPY --from=builder --chown=server:nodejs /app/packages/db-migrator/dist ./migrate


EXPOSE 8080

CMD ["sh", "-c", "export SERVER_PORT=${SERVER_PORT:-${PORT:-8080}}; node ./migrate/index.js && exec node ./dist/index.js"]
