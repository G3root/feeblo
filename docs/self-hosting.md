# Self-hosting Feeblo

This is the supported path for running the dashboard, the API, and the public boards from the images in `docker-compose.yml`. It is a production-shaped stack: it expects HTTPS hostnames and a real mail server, not the development ports from the quickstart.

## Requirements

- Docker with Compose ≥ 2.24 (the stack uses an optional `env_file`).
- A domain you control with wildcard DNS for public boards, e.g. `*.feedback.example.com`.
- TLS termination in front of both the dashboard and the API. The session cookie is `Secure; SameSite=None` in production, so **an HTTP-only deployment cannot keep a user signed in**.
- A transactional mail server. Account creation verifies the address by email; without SMTP, sign-up cannot complete unless you turn verification off.
- An S3-compatible bucket for uploads (Cloudflare R2 or equivalent). See [r2-production-checklist.md](./r2-production-checklist.md).

## 1. DNS and TLS

Point the dashboard and API at the same host (or a proxy in front of it):

| Name                       | Target                            |
| -------------------------- | --------------------------------- |
| `feedback.example.com`     | the `web` service                 |
| `*.feedback.example.com`   | the `web` service (public boards) |
| `api.feedback.example.com` | the `server` service              |

Terminate TLS at a reverse proxy you already run, or add one to the stack. A minimal Caddy configuration for a proxy on the Docker host:

```caddyfile
feedback.example.com, *.feedback.example.com {
  reverse_proxy 127.0.0.1:4321
}

api.feedback.example.com {
  reverse_proxy 127.0.0.1:8080
}
```

The wildcard certificate needs a DNS-01 challenge; that is a proxy configuration, not a Feeblo one.

If the proxy is the only route to the API, tell the server to trust its `X-Forwarded-For` (see [Rate limits and proxies](#rate-limits-and-proxies)). If the published `8080` port is reachable directly, do not trust forwarded headers from it — use `TRUSTED_PROXY_IPS` with the proxy's network instead.

## 2. Configure

The deployment must **not** use the development `.env`. Its `DATABASE_URL` and `REDIS_URL` point at the dev stack's host ports, and its origins use the dev ports; inside a container those addresses are the container itself.

```sh
test -f docker/.env.selfhost || (umask 077 && cp docker/.env.selfhost.example docker/.env.selfhost)
chmod 600 docker/.env.selfhost
$EDITOR docker/.env.selfhost
```

Fill at least:

- `POSTGRES_PASSWORD`, and the same password inside `DATABASE_URL`. If the password contains URI-reserved characters (`@ : / ? # [ ]` or `%`), percent-encode them in `DATABASE_URL` (for example `p@ss` → `p%40ss`) or use a password made of URL-safe characters.
- `APP_URL`, `API_URL`, `APP_ROOT_DOMAIN`, `APP_RELEASE`.
- `AUTH_ENCRYPTION_KEY` (`openssl rand -hex 32`).
- `SMTP_*`, including a sender address on a domain you have authenticated.
- The five required `MEDIA_*` values (region, endpoint, access key, secret, public base URL) plus `MEDIA_PUBLIC_BUCKET_NAME` if it is not the default.

Every variable in `.env.example` is read from this file; the example file keeps the optional sections commented. In particular:

- Social login: register `<API_URL>/api/auth/callback/github` and `<API_URL>/api/auth/callback/google`.
- GitHub App: callback `<API_URL>/github/app/installations/callback`, webhook `<API_URL>/github/app/webhooks`.
- Sentry, Databuddy, embeddings and OTLP are off unless their keys are uncommented.
- `AUTH_SIGN_UP_ENABLED`, `AUTH_EMAIL_VERIFICATION_REQUIRED`, `ALLOWED_EMAILS` and `TURNSTILE_*` control who can register.

`DATABASE_URL` and `REDIS_URL` must use the compose service names `pg` and `redis`, which the self-host example already does.

`AUTH_TRUSTED_ORIGINS` is derived from `APP_URL`, `API_URL` and `*.APP_ROOT_DOMAIN` when unset. A nonempty value **replaces** that derived list, so include all three plus any additional board hostname.

## 3. Start

```sh
docker compose --env-file docker/.env.selfhost up -d
```

`--env-file` replaces the default `.env`, so the dev file is never read. The server image runs the migrator before it starts listening; on a new database the first boot takes as long as the migrations need.

The server receives the operator file through `env_file`, so the optional integrations are not dropped by a hand-written allow-list. The web service gets an explicit allow-list of only the public settings it needs (its origins, the Sentry DSN, the Databuddy client id and Turnstile site key, and the media/CSP origins); the database, mail, auth and object-storage secrets never enter that container.

## 4. Verify

```sh
curl -fsS https://api.feedback.example.com/health
# {"status":"ok","release":"..."}

curl -fsS https://feedback.example.com/ >/dev/null
```

Then open the dashboard, create the first account, and confirm the verification email arrives. If it does not, check the container logs and the `SMTP_*` values; the sign-up request fails when the mail send fails.

## Rate limits and proxies

The API partitions per-IP rate limits on the client address, and it only trusts forwarded headers when told to. Behind a proxy, set one of:

```dotenv
# The proxy is on a known Docker network (preferred).
TRUSTED_PROXY_IPS=172.18.0.0/16

# Or: every hop is trusted. Only safe when the API port is not directly
# reachable (bind 8080 to 127.0.0.1 or firewall it).
TRUST_PROXY_HEADERS=true
```

With neither value, every anonymous visitor shares the proxy's address and the public limits trip globally. `TRUST_PROXY_HEADERS=true` on a directly reachable `8080` lets a caller spoof `X-Forwarded-For` and evade the limits.

## Public boards

Boards answer on `<workspace>.APP_ROOT_DOMAIN`. They need:

- wildcard DNS for `*.APP_ROOT_DOMAIN`;
- a certificate that covers the wildcard;
- `APP_URL`/`APP_ROOT_DOMAIN` matching that hostname, so the dashboard and the boards are same-site for the session cookie.

The server-side render calls the API over `API_URL_INTERNAL` (compose defaults it to `http://server:8080`), while the browser uses `API_URL`. Keep the two apart when the public API origin is not routable from inside the web container.

## HTTPS and cookies

Production sets `Secure; SameSite=None` session cookies and a shared cookie domain on `APP_ROOT_DOMAIN`. That is what lets a signed-in visitor move between the dashboard and board subdomains, and it is why:

- plain HTTP cannot hold a session;
- `APP_ROOT_DOMAIN` must be a real registrable domain, not `localhost` or an IP address (Chromium rejects `Domain=localhost`).

For local evaluation, put a TLS proxy in front of the stack and use a hostname that resolves locally, or use the development setup in the README instead.

## Upgrades

```sh
docker compose --env-file docker/.env.selfhost pull
docker compose --env-file docker/.env.selfhost up -d
```

The server runs migrations on start and serializes them with an advisory lock, so replicas can be rolled one at a time. Take a database backup before a release that changes the schema:

```sh
docker compose --env-file docker/.env.selfhost exec pg \
  sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' \
  > feeblo-$(date +%F).dump
```

Object storage is not in the database; back up the bucket separately.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Sign-in succeeds, then the app is anonymous again | The deployment is on HTTP, or `APP_ROOT_DOMAIN` is `localhost`/an IP. Use HTTPS and a real root domain. |
| State-changing requests return 403 | The page origin is not in `AUTH_TRUSTED_ORIGINS`. It is derived from `APP_URL`, `API_URL` and `*.APP_ROOT_DOMAIN` when unset; a nonempty value replaces that derived list, so include all of them plus any custom board hostname. |
| Public boards show the unavailable page | The web process cannot reach the API. Check `API_URL_INTERNAL` and that the `server` service is healthy. |
| Everyone hits rate limits at once | The proxy's IP is used as the client IP. Set `TRUSTED_PROXY_IPS` or `TRUST_PROXY_HEADERS`. |
| Sign-up fails or no email arrives | SMTP is not configured or the sender domain is not authenticated. |
| `docker compose up` refuses a value | The `:?` checks (encryption key, media credentials) or the server's own startup validation is reporting a missing required value; read the message. |
| Container restarts after an upgrade | The migrator failed. Check `docker compose --env-file docker/.env.selfhost logs server`; the old image can be restored from the previous `IMAGE_TAG`. |
