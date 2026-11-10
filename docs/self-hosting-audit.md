# Self-hosting audit

Read-only audit of the container path: `docker-compose.yml`, `apps/server/Dockerfile`, `apps/web/Dockerfile`, `.env.example`, the pieces of `apps/server` and `apps/web` the compose stack actually runs, and `.github/workflows/ci.yml`'s `docker_smoke_test`.

The findings below are the audit as written, before any fix. The status section records what this branch changes; the stack itself was not built or booted, and the only runtime check performed was `docker compose config`.

## Status in this change

Fixed in the same branch:

- **P0.1** — `docker/.env.selfhost.example`, `docs/self-hosting.md` and the README now document a dedicated operator file passed with `--env-file`, so the dev `.env` is no longer the production stack's input.
- **P0.2** — compose defaults for `APP_URL`/`API_URL` now match the published ports (`4321`/`8080`), and the web service receives `API_URL_INTERNAL`.
- **P1.5** — the web and server services read the operator file through `env_file`, so the optional integrations are no longer dropped by the hand-written list.
- **P1.6** — `TRUST_PROXY_HEADERS`/`TRUSTED_PROXY_IPS` are forwarded by compose and documented in `.env.example`, the operator file and the self-hosting guide.
- **P1.7** — `API_URL_INTERNAL` gives SSR its own API origin, separate from the browser-facing `API_URL`.
- **P1.8** — the dead `SMTP_TRANSPORT` setting is removed from `.env.example`.
- **P1.9 / P2.5** — `APP_ENV`/`NO_INDEX` are forwarded; registration controls, Turnstile, proxy trust and integration concurrency are documented.
- **P2.1** — Postgres and Redis no longer publish host ports.
- **P2.2** — the web service has a healthcheck.

Still open, and deliberately left for a follow-up because each changes behaviour or needs owner sign-off:

- **P0.3** — HTTPS is now a documented requirement, but the stack still boots on HTTP with cookies that cannot work. Rejecting HTTP at startup or shipping a proxy is a policy decision.
- **P0.4** — SMTP remains a documented requirement rather than a startup check.
- **P2.3/P2.4/P2.6** — `container_name`, image pinning and the Dockerfile Node version were left alone.
- **P2.7** — the smoke test still only checks that containers stay up; `.github/workflows/` changes need sign-off.

## What already works

These are load-bearing and were verified by reading, not by running:

- The server image runs the migrator before the app (`apps/server/Dockerfile` `CMD`), and the migrator serializes replicas with an advisory lock, builds concurrent indexes, and validates the deferred constraints after the batch commits.
- `AUTH_ENCRYPTION_KEY` and the six `MEDIA_*` values fail startup instead of booting a half-configured instance; `.env.example` placeholders are explicitly rejected.
- `REDIS_URL` is mandatory in production, so rate limits are not silently per-replica.
- `pg` and `redis` have healthchecks and the server waits for both.
- `GET /health` needs no database and returns `{ status, release }`.
- The web image sets `CLOUDFLARE_ADAPTER=false`, `HOST=0.0.0.0`, a fixed `PORT=4321` and serves `dist/client` before the SSR handler.
- `AUTH_TRUSTED_ORIGINS` defaults are expanded by compose (`*.${APP_ROOT_DOMAIN}`), and nested interpolation works on the installed Compose (29.8.2).

## P0 — the documented path does not produce a working instance

### 1. The dev `.env` is also the production compose file's input

`README.md` says `cp .env.example .env` and also says the production stack lives in `docker-compose.yml`. Compose auto-loads `.env` for interpolation, and the compose file reads most values back out of it with `${VAR:-default}`.

That matters because `.env.example` is written for `docker/docker-compose.dev.yml`:

| Key | `.env.example` (dev) | Container needs |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://feeblo:password@127.0.0.1:54323/feeblo` | `postgres://…@pg:5432/feeblo` |
| `REDIS_URL` | `redis://127.0.0.1:63799/0` | `redis://redis:6379/0` |
| `SMTP_HOST` / `SMTP_PORT` | `127.0.0.1` / `1025` | an SMTP host reachable from the container |
| `APP_ROOT_DOMAIN` | `localhost:3001` | the deployment's real root domain |
| `MEDIA_UPLOAD_ENDPOINT` | `http://127.0.0.1:9002` | a real S3/R2 endpoint |

Reproduced with the documented flow, filling only the one required value `.env.example` leaves empty (`MEDIA_PUBLIC_BASE_URL`):

```sh
docker compose --env-file .env.example config | grep -E 'DATABASE_URL|REDIS_URL'
# DATABASE_URL: postgres://feeblo:password@127.0.0.1:54323/feeblo
# REDIS_URL:    redis://127.0.0.1:63799/0
```

Inside the `server` container those are the container's own loopback. The migrator fails with `ECONNREFUSED` and the process exits before the app starts; `restart: always` turns that into a crash loop. `REDIS_URL` is set, so the "required in production" check passes, but the rate limiter cannot reach Redis either.

The compose defaults (`@pg:5432`, `@redis:6379`) are correct; they are simply unreachable whenever `.env` exists, which is the documented state.

### 2. Published ports and configured URLs disagree

Compose publishes:

- server: `${SERVER_PORT:-8080}:8080`
- web: `${WEB_PORT:-4321}:4321`

but the configured origins are:

- `API_URL=http://localhost:3000`
- `APP_URL=http://localhost:3001`
- `.env.example` `APP_ROOT_DOMAIN=localhost:3001`

So a visitor opens the dashboard at `http://localhost:4321`, the injected runtime env tells the browser the API is at `http://localhost:3000` (nothing is published there), and `AUTH_TRUSTED_ORIGINS` becomes `http://localhost:3001,http://localhost:3000,*.localhost:3001` (from `docker compose config`). The page origin `http://localhost:4321` is not trusted by `makeIsAllowedOrigin` (nonzero `Origin` on a state-changing RPC gets a 403 from `http/middleware/origin-check.ts`), and the API call would fail at the socket level first. Public boards on `acme.localhost:3001` also point at an unbound port.

The CI smoke test repeats the same mismatch: it sets `APP_URL=http://localhost:3001` while publishing web on 4321 and the API on 8080.

### 3. Production mode requires HTTPS, but the stack ships HTTP

`NODE_ENV: production` is hardcoded for both services. In `packages/auth/src/server.ts` better-auth is configured unconditionally with:

```ts
defaultCookieAttributes: { secure: true, httpOnly: true, sameSite: "none" },
advanced: { crossSubDomainCookies: { enabled: nodeEnv === "production", domain: appRootDomain.split(":")[0] } },
```

Over `http://localhost` (or a LAN IP) the browser drops a `Secure` cookie, and `SameSite=None` without `Secure` is rejected outright — so sign-in and sign-up set a session that never comes back. With `APP_ROOT_DOMAIN=localhost`, Chromium rejects the `Domain=localhost` cookie as well (the code's own comment says so), even though `crossSubDomainCookies` is enabled in production.

Nothing in `docker-compose.yml` or the README's Deployment section provides a TLS terminator or states that HTTPS (and a real root domain) is required. The security-headers code even assumes one — "the Node container answers plain HTTP behind the TLS-terminating proxy" — but the compose stack has no proxy.

### 4. The first sign-up cannot complete without SMTP, and the stack ships none

`AUTH_EMAIL_VERIFICATION_REQUIRED` defaults to `true`, and the verification code is mailed inline from `sendVerificationOTP` (`packages/auth/src/server.ts`), awaiting `sendUnlessSuppressed(...)` with no catch. If SMTP is absent the send rejects; depending on how better-auth handles that, the sign-up request errors or the account exists with no code ever delivered. Either way the first account cannot be verified.

The compose file forwards `SMTP_*` but defaults them empty (except the forwarded `.env` values, which are `127.0.0.1:1025` — the container itself). `.env.example` `SMTP_FROM_ADDRESS` is also `noreply@feeblo.com`, i.e. a domain the operator does not control, which will fail SPF/DKIM/sender verification even when SMTP is configured.

Net effect: a fresh self-host can create no usable account, and the failure looks like a broken sign-up form rather than missing infrastructure.

## P1 — configuration that silently does nothing

### 5. Compose forwards a hand-picked list; `.env.example` documents far more

`docker-compose.yml` interpolates a hand-picked list of roughly twenty app variables (42 names if ports, image tags and Postgres bootstrap values are counted). Everything else an operator puts in `.env` is read by the app but never reaches a container. Missing and read by the code:

| Area | Not forwarded |
| --- | --- |
| Social login | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub App | `GITHUB_INTEGRATION_APP_ID`, `_APP_SLUG`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_PRIVATE_KEY`, `_WEBHOOK_SECRET` |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_OAUTH_REDIRECT_URL` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_OAUTH_REDIRECT_URL` |
| Billing | `POLAR_MODE`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET` |
| Embeddings | `EMBEDDING_API_KEY`, `EMBEDDING_API_URL`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` |
| Errors/analytics | `SENTRY_DSN`, `POSTHOG_KEY`, `POSTHOG_HOST` |
| Email | `SMTP_TRANSPORT`, `EMAIL_OUTBOX_*` (6 values) |
| Deployment | `APP_ENV`, `NO_INDEX`, `INTEGRATION_ENCRYPTION_KEY`, `INTEGRATION_ALLOW_PRIVATE_NETWORK`, `PROFANITY_EXTRA_WORDS` |
| Telemetry | `OTEL_EXPORTER_OTLP_{TRACES,LOGS,METRICS}_*`, `FEEBLO_TELEMETRY_LOG_LEVEL`, `FEEBLO_TELEMETRY_DROP_ROOT_SPANS` |

Two examples that contradict documentation directly:

- `README.md`: "Set `EMBEDDING_API_KEY` to enable embeddings". Through compose, setting it does nothing.
- `docs/telemetry.md`: `.env` for `docker-compose.yml` "passes the endpoint, headers, and sample rate through". It passes the base endpoint and headers, not the per-signal `OTEL_EXPORTER_OTLP_TRACES_HEADERS` / `_LOGS_HEADERS` / `_METRICS_HEADERS` that the Axiom recipe in `.env.example` depends on.

`makeSentryObservability` returns an empty layer without `SENTRY_DSN`, so error reporting is off in a compose deployment unless the operator edits the compose file.

### 6. Reverse-proxy trust is undocumented and unforwarded

`apps/server/src/config.ts` reads `TRUST_PROXY_HEADERS` and `TRUSTED_PROXY_IPS` to build `ClientIp`, which rate limits key on (`public-rpc:${name}:${clientIp.address}`). Both default off, appear nowhere in `.env.example` and nothing in `docker-compose.yml` forwards them.

A self-hosted instance is expected to sit behind a TLS-terminating proxy. With the defaults, every request carries the proxy's address as its client IP, so all anonymous traffic shares one rate-limit bucket. Public sign-up, password reset, and public RPC limits then trip globally instead of per visitor. There is no way to fix it through the documented configuration surface — only by editing compose.

### 7. Web SSR calls the API at the browser-facing `API_URL`

Server-side board rendering resolves the site and page content over RPC at `process.env.API_URL` (`apps/web/src/dashboard/lib/runtime-server.ts`, `public-board-data.ts`), and the browser telemetry relay does the same (`apps/web/src/routes/telemetry/$signal.ts`). There is one `API_URL`, injected into `window.global.__ENV` for the browser as well.

In compose with the defaults the SSR fetch goes to `http://localhost:3000` inside the web container, so a public board resolves to `rpc-unavailable` and telemetry relays a 502. Setting `API_URL=http://server:8080` to fix SSR breaks the browser, because `server` does not resolve there and the OG image URLs would point at it too. A single public hostname that also resolves inside the compose network is the only value that works for both, and the stack does not document or provide one.

### 8. `SMTP_TRANSPORT` is documented but dead

`.env.example` documents `SMTP_TRANSPORT="smtp-auth" | "smtp-api" | "resend"`. Nothing in the repository reads it; `packages/transactional/src/mailer.ts` only builds a nodemailer SMTP transport. An operator switching to Resend gets no change and no error.

### 9. Staging controls cannot be set

`NO_INDEX` and `APP_ENV` are read by the web process (`apps/web/src/routes/__root.tsx`, `dashboard/lib/server-runtime-public-env.ts`) and by the server for telemetry/ `Sentry` environment labels, and neither is forwarded. A staging deployment on this stack is indexable and reports its telemetry as `production`.

## P2 — hardening and operability

1. **The database and cache are published to the host.** `docker-compose.yml` maps `${POSTGRES_PORT:-5432}:5432` and `${REDIS_PORT:-6379}:6379`. Neither is needed: the app reaches them by service name. Defaults are `POSTGRES_PASSWORD=password` and a Redis with no password. On a VPS this is a database and an unauthenticated cache reachable from the public interface, with a well-known default credential. The dev compose deliberately uses 54323/63799 to avoid collisions; the production compose picks the collision-prone defaults.
2. **No `web` healthcheck** (and no `/health` route on the web app). `server` has an image-level healthcheck; `web` is considered up as soon as it is running, so `docker compose up --wait` and orchestrators cannot tell a 500-ing web process from a working one.
3. **`container_name` prevents scaling.** Every service pins a name, so `docker compose up --scale server=2` fails before the migrator's advisory lock is ever useful. The composition root and migrator are explicitly written for replicas.
4. **Floating image tags.** `pgvector/pgvector:pg17`, `redis:7-alpine`, and `ghcr.io/…:${IMAGE_TAG:-latest}` mean an unpinned pull can cross major versions; the app's own dependency versioning is far stricter than its infrastructure's.
5. **Undocumented self-host controls.** `ALLOWED_EMAILS`, `AUTH_SIGN_UP_ENABLED` (defaults `true` — open registration), `AUTH_EMAIL_VERIFICATION_REQUIRED`, `AUTH_AUTO_SIGN_IN_AFTER_SIGN_UP`, `TURNSTILE_SECRET_KEY` / `TURNSTILE_SITE_KEY`, `INTEGRATION_CONNECTION_CONCURRENCY`, `INTEGRATION_GLOBAL_CONCURRENCY` are read but absent from `.env.example`. Setting the Turnstile secret without the site key makes sign-up unsolvable (the server enforces captcha, the web renders no widget).
6. **Node version drift.** `.node-version` is `26.4.0`; both Dockerfiles use `NODE_VERSION=26.12.1`.
7. **The smoke test only proves the containers stay up.** `docker_smoke_test` runs `docker compose up -d --wait`, whose own env has the port/URL mismatch above, and never requests `/health`, the web root, a login, or an upload. It would pass the P0 defects above. There is no check that the compose env list covers the keys `.env.example` documents.

## Verification commands used

```sh
# The documented env flow against the production compose file.
# Fails fast on the empty MEDIA_PUBLIC_BASE_URL until one is supplied.
docker compose --env-file .env.example config

# What compose actually interpolates vs what .env.example documents
grep -o '\${[A-Z0-9_]*' docker-compose.yml | sed 's/\${//' | sort -u
comm -23 <(grep -oE '^[A-Z][A-Z0-9_]*=' .env.example | tr -d = | sort -u) \
         <(grep -o '\${[A-Z0-9_]*' docker-compose.yml | sed 's/\${//' | sort -u)
```

## The shape of a fix

1. **Stop sharing `.env` between the two stacks.** Ship an operator env file (`docker/.env.selfhost.example` or similar) with `pg`/`redis`/SMTP service names, real `APP_URL`/`API_URL`/`APP_ROOT_DOMAIN`, a 32-byte `AUTH_ENCRYPTION_KEY`, and the operator's own sender address. Document `docker compose --env-file … up -d` as the supported command. Do not make correctness depend on the operator noticing that `DATABASE_URL` in the quickstart file is wrong for production.
2. **Forward the whole environment, not a hand-picked list.** Add `env_file` to both services and override only the container-internal values (`DATABASE_URL`, `REDIS_URL`) in `environment`, or forward the missing keys explicitly. A test that diffs `.env.example` keys against compose coverage would keep it honest.
3. **Split browser and server API origins.** Add `API_URL_INTERNAL` (e.g. `http://server:8080`) for `apps/web`'s server-side runtime and the telemetry relay, keeping `API_URL` for the browser and OG images.
4. **Make TLS a documented requirement, and fail loudly without it.** Either ship a proxy in the self-host compose or make the cookie policy depend on the `APP_URL` scheme, with a startup warning that HTTP cannot hold a session. Also reject `APP_ROOT_DOMAIN=localhost`/address literals in production.
5. **Decide what email is.** Either require SMTP (or an outbox transport) at startup, or default verification off, or return a clear diagnostic instead of a failed sign-up. Remove or implement `SMTP_TRANSPORT`, and stop defaulting the sender to `feeblo.com`.
6. **Publish only what must be public.** Drop the `pg`/`redis` port mappings, require `POSTGRES_PASSWORD`, and document proxy trust (`TRUST_PROXY_HEADERS` / `TRUSTED_PROXY_IPS`) next to the TLS guidance.
7. **Give CI something behavioural to check.** Extend `docker_smoke_test` to assert `GET /health`, `GET /` on the web origin, and one board page over the configured hostname; add the env-coverage check. That is what would have caught P0 items 1–4.
8. **Smaller:** add a `web` healthcheck, drop `container_name` in favour of `COMPOSE_PROJECT_NAME`, pin infrastructure image tags, align the Dockerfile Node version with `.node-version`, and forward `NO_INDEX`/`APP_ENV`/Sentry/PostHog.
