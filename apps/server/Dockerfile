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

RUN pnpm turbo build

FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ARG APP_RELEASE="dev"
ARG APP_URL=""
ARG API_URL=""
ARG APP_ROOT_DOMAIN=""
ARG DATABASE_URL=""
ARG REDIS_URL=""
ARG AUTH_ENCRYPTION_KEY=""
ARG SMTP_HOST=""
ARG SMTP_PORT=""
ARG SMTP_SECURE=""
ARG SMTP_UNSAFE_IGNORE_TLS=""
ARG SMTP_SERVICE=""
ARG SMTP_USERNAME=""
ARG SMTP_PASSWORD=""
ARG SMTP_FROM_ADDRESS=""
ARG POLAR_MODE="sandbox"
ARG POLAR_ACCESS_TOKEN=""
ARG POLAR_WEBHOOK_SECRET=""
ARG SENTRY_DSN=""
ARG SENTRY_ENVIRONMENT=""
ARG SENTRY_TRACES_SAMPLE_RATE=""
ARG EMBEDDING_API_KEY=""
ARG EMBEDDING_API_URL=""
ARG EMBEDDING_TIMEOUT=""
ARG EMBEDDING_MODEL=""
ARG EMBEDDING_DIMENSIONS=""
ARG MEDIA_UPLOAD_REGION=""
ARG MEDIA_UPLOAD_ENDPOINT=""
ARG MEDIA_UPLOAD_ACCESS_KEY_ID=""
ARG MEDIA_UPLOAD_SECRET_ACCESS_KEY=""
ARG MEDIA_PUBLIC_BUCKET_NAME=""
ARG MEDIA_PUBLIC_BASE_URL=""
ARG PROFANITY_CHECK_API_URL=""

ENV NODE_ENV=production
ENV SERVER_PORT=8080
ENV APP_RELEASE="${APP_RELEASE}"
ENV APP_URL="${APP_URL}"
ENV API_URL="${API_URL}"
ENV APP_ROOT_DOMAIN="${APP_ROOT_DOMAIN}"
ENV DATABASE_URL="${DATABASE_URL}"
ENV REDIS_URL="${REDIS_URL}"
ENV AUTH_ENCRYPTION_KEY="${AUTH_ENCRYPTION_KEY}"
ENV SMTP_HOST="${SMTP_HOST}"
ENV SMTP_PORT="${SMTP_PORT}"
ENV SMTP_SECURE="${SMTP_SECURE}"
ENV SMTP_UNSAFE_IGNORE_TLS="${SMTP_UNSAFE_IGNORE_TLS}"
ENV SMTP_SERVICE="${SMTP_SERVICE}"
ENV SMTP_USERNAME="${SMTP_USERNAME}"
ENV SMTP_PASSWORD="${SMTP_PASSWORD}"
ENV SMTP_FROM_ADDRESS="${SMTP_FROM_ADDRESS}"
ENV POLAR_MODE="${POLAR_MODE}"
ENV POLAR_ACCESS_TOKEN="${POLAR_ACCESS_TOKEN}"
ENV POLAR_WEBHOOK_SECRET="${POLAR_WEBHOOK_SECRET}"
ENV SENTRY_DSN="${SENTRY_DSN}"
ENV SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT}"
ENV SENTRY_TRACES_SAMPLE_RATE="${SENTRY_TRACES_SAMPLE_RATE}"
ENV EMBEDDING_API_KEY="${EMBEDDING_API_KEY}"
ENV EMBEDDING_API_URL="${EMBEDDING_API_URL}"
ENV EMBEDDING_TIMEOUT="${EMBEDDING_TIMEOUT}"
ENV EMBEDDING_MODEL="${EMBEDDING_MODEL}"
ENV EMBEDDING_DIMENSIONS="${EMBEDDING_DIMENSIONS}"
ENV MEDIA_UPLOAD_REGION="${MEDIA_UPLOAD_REGION}"
ENV MEDIA_UPLOAD_ENDPOINT="${MEDIA_UPLOAD_ENDPOINT}"
ENV MEDIA_UPLOAD_ACCESS_KEY_ID="${MEDIA_UPLOAD_ACCESS_KEY_ID}"
ENV MEDIA_UPLOAD_SECRET_ACCESS_KEY="${MEDIA_UPLOAD_SECRET_ACCESS_KEY}"
ENV MEDIA_PUBLIC_BUCKET_NAME="${MEDIA_PUBLIC_BUCKET_NAME}"
ENV MEDIA_PUBLIC_BASE_URL="${MEDIA_PUBLIC_BASE_URL}"
ENV PROFANITY_CHECK_API_URL="${PROFANITY_CHECK_API_URL}"

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
