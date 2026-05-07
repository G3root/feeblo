FROM node:24 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PNPM_HOME/bin:$PATH
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

ENV CI=true
ENV NODE_ENV=production

WORKDIR /app/apps/web
RUN pnpm exec astro build

FROM base AS runner
WORKDIR /app

ENV CI=true
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

COPY --from=installer /app /app

WORKDIR /app/apps/web
EXPOSE 4321

CMD ["sh", "-c", "test -n \"$PUBLIC_API_URL\" && test -n \"$PUBLIC_APP_URL\" && test -n \"$PUBLIC_APP_ROOT_DOMAIN\" && exec node /app/node_modules/astro/bin/astro.mjs preview --host 0.0.0.0 --port ${PORT:-4321}"]
