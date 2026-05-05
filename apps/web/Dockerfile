FROM node:lts AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS turbo-cli
RUN pnpm add -g turbo

FROM turbo-cli AS builder
WORKDIR /app
COPY . .
RUN turbo prune @feeblo/web --docker

FROM base AS installer
WORKDIR /app

COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .

ARG GIT_COMMIT_SHA="unknown"
ARG VITE_API_URL=""
ARG VITE_APP_URL=""
ARG VITE_APP_ROOT_DOMAIN=""

LABEL org.opencontainers.image.revision=$GIT_COMMIT_SHA
ENV CI=true
ENV NODE_ENV=production
ENV GIT_COMMIT_SHA="${GIT_COMMIT_SHA}"
ENV VITE_API_URL="${VITE_API_URL}"
ENV VITE_APP_URL="${VITE_APP_URL}"
ENV VITE_APP_ROOT_DOMAIN="${VITE_APP_ROOT_DOMAIN}"

RUN test -n "$VITE_API_URL" \
  && test -n "$VITE_APP_URL" \
  && test -n "$VITE_APP_ROOT_DOMAIN"

WORKDIR /app/apps/web
RUN pnpm exec astro build

FROM base AS runner
WORKDIR /app

ARG GIT_COMMIT_SHA="unknown"
ARG VITE_API_URL=""
ARG VITE_APP_URL=""
ARG VITE_APP_ROOT_DOMAIN=""

LABEL org.opencontainers.image.revision=$GIT_COMMIT_SHA
ENV CI=true
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321
ENV GIT_COMMIT_SHA="${GIT_COMMIT_SHA}"
ENV VITE_API_URL="${VITE_API_URL}"
ENV VITE_APP_URL="${VITE_APP_URL}"
ENV VITE_APP_ROOT_DOMAIN="${VITE_APP_ROOT_DOMAIN}"

COPY --from=installer /app /app

WORKDIR /app/apps/web
EXPOSE 4321

CMD ["sh", "-c", "exec node /app/node_modules/astro/bin/astro.mjs preview --host 0.0.0.0 --port ${PORT:-4321}"]
