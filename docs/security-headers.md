# Response security headers

Two entry points attach them, and nothing else in the tree does:

| Surface | Where | Module |
| --- | --- | --- |
| `apps/server` — `/rpc`, `/api/v1`, `/mcp`, `/api/auth/*`, provider webhooks, `/og-image`, `/health` | `withGlobalMiddleware` in `apps/server/src/app/router.ts` | `apps/server/src/http/security-headers.ts` |
| `apps/web` — dashboard, public board (`/s/*`), widget shell (`/feedback-widget/*`), SSR route errors | the fetch entry in `apps/web/src/server.ts` | `apps/web/src/lib/security-headers.ts` |

The web entry is the one place both deployments pass through: the Cloudflare Worker resolves `@tanstack/react-start/server-entry` to it, and `server.mjs` imports the built handler from it. Static assets (`/assets/*`, `/widget/*`) are answered by srvx's static middleware before the entry and carry only their own `Content-Type`; they are bundles and fonts, not documents, so the directives that matter do not apply.

## Why framing is the load-bearing directive

The production session cookie is `Domain=<root>; Secure; HttpOnly; SameSite=None` (`packages/auth/src/server.ts`), because boards on tenant subdomains and the widget iframe share one session. A browser therefore attaches it to a **cross-site iframe**. The CSRF origin check in `apps/server/src/http/origin-check.ts` cannot see that attack: a framed document makes same-origin requests, so a third-party page could frame `app.<root>` and clickjack upvote, comment, delete, or member-removal clicks.

Everything answers `frame-ancestors 'none'` and `X-Frame-Options: DENY` except `/feedback-widget/*`, which answers `frame-ancestors *` and no `X-Frame-Options` — embedding that document in customer pages is the product.

## Why `img-src` is an allow-list

Post bodies, comments, and changelogs render author-supplied Markdown through `dangerouslySetInnerHTML`. A `![](https://attacker/pixel)` in a public post is fetched by every anonymous visitor, handing the author the visitor's IP and — before `Referrer-Policy` — the page they came from. The policy allows only:

- `'self'`, `data:`, `blob:`
- the origin in `MEDIA_PUBLIC_BASE_URL` (uploaded editor media, logos, covers)
- the default OAuth avatar hosts (Google, GitHub) the auth package configures
- any origin listed in `CONTENT_IMAGE_ORIGINS` (comma-separated, absolute)

Anything else is blocked. The editor uploads images to object storage, so the normal path is unaffected; a post that references a third-party image needs that host allow-listed, and a workspace whose SSO returns avatars from its own CDN must name that origin. `MEDIA_PUBLIC_BASE_URL` is read by the web process as well as the server for exactly this reason.

## Why there is no `default-src`

The app inlines the runtime env script, ships Tailwind's generated CSS, loads the widget bundle from a second origin in dev, streams over WebSockets, and the API serves a Scalar reference page that fetches its own bundle from a CDN. A fallback directive would take one of those offline on deploy. The API policy therefore carries only `frame-ancestors` and `base-uri`; the page policy adds `object-src`, `form-action`, and `img-src`. Extend a directive when its breakage has been verified, not before.

## HSTS

`Strict-Transport-Security` is sent when the deployment declares that its public origin is HTTPS:

- **Web:** `APP_URL` is `https:`.
- **API:** `NODE_ENV=production` or `API_URL` is `https:`.

The request URL is deliberately not consulted. The Node containers answer plain HTTP behind the operator's TLS-terminating proxy, so the request scheme would always say `http:` and the header would never be sent where it is needed; an adapter that honours forwarded headers would instead let the caller decide. Both signals above are operator configuration, so a spoofed `X-Forwarded-Proto` can only ever lose the header, never add one.

`NODE_ENV` is not consulted on the web side either: the server bundle is built by Vite, which replaces `process.env.NODE_ENV` with the build mode, so it is the constant `"production"` at runtime and would send HSTS from every deployment. `APP_URL` is read at runtime and covers the same case. Development over `http://localhost` sends none.

## Verified

`apps/web/src/lib/security-headers.test.ts` and `apps/server/src/http/security-headers.test.ts` cover the widget exception, the image allow-list (including that a configured value cannot inject a second directive), the `img-src` refusal of bare `https:`/`*` sources, HSTS conditions, and that the API policy keeps no resource fallback.
