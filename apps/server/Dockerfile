FROM node:24 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PNPM_HOME/bin:$PATH
RUN corepack enable

FROM base AS turbo-cli
RUN pnpm add -g turbo

FROM turbo-cli AS builder
WORKDIR /app
COPY . .
RUN turbo prune @feeblo/server --docker

FROM base AS installer
WORKDIR /app

COPY --from=builder /app/out/json/ .
RUN pnpm install --frozen-lockfile

COPY --from=builder /app/out/full/ .

ARG PUBLIC_APP_URL=""
ARG PUBLIC_API_URL=""
ENV NODE_ENV=production
ENV PUBLIC_APP_URL="${PUBLIC_APP_URL}"
ENV PUBLIC_API_URL="${PUBLIC_API_URL}"

WORKDIR /app/apps/server
RUN pnpm exec rolldown -c

FROM base AS runner
WORKDIR /app

ARG PUBLIC_APP_URL=""
ARG PUBLIC_API_URL=""

ENV NODE_ENV=production
ENV SERVER_PORT=8080
ENV PUBLIC_APP_URL="${PUBLIC_APP_URL}"
ENV PUBLIC_API_URL="${PUBLIC_API_URL}"

COPY --from=installer /app/apps/server/dist /app/apps/server/dist

WORKDIR /app/apps/server
EXPOSE 8080

CMD ["sh", "-c", "export SERVER_PORT=${SERVER_PORT:-${PORT:-8080}}; exec node ./dist/index.js"]
