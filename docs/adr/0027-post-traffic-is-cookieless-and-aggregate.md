# ADR 0027: Post traffic is cookieless and aggregate-only

## Decision

A post's view count is recorded by a first-party beacon and stored in two tables: `post_view_event`, one row per view with a timestamp and four coarse dimensions (`country`, `os`, `browser`, `device`), and `post_view_total`, an all-time counter per post. The dashboard reads both through `GetPostTraffic`; the public board renders neither.

The data contract is the decision:

- **No IP address is stored.** The API receives it (and discards it) only as a rate-limiting side effect; the analytics columns never carry it.
- **No user agent is stored.** It is parsed at ingest into `os` / `browser` / `device` and then dropped. The relay forwards it in the request body because some server runtimes overwrite the outbound `User-Agent`, not because it is data worth keeping. The browser also sends the one form-factor hint the agent cannot prove (touch points separate an iPad from a Mac); without a hint a Macintosh agent is `unknown`, never assumed desktop.
- **No visitor identifier exists.** There is no daily salt, no hash, no cookie, no `localStorage` id. The client deduplicates one view per post per tab session in `sessionStorage`, which is a client-side convenience and not an identity the server can read.
- **Country comes from the edge.** The relay forwards `CF-IPCountry`; the handler accepts it only when the request crossed the configured relay/proxy trust boundary, and otherwise stores `""` ("unknown"), not an inferred value or a caller-supplied guess. No GeoIP database is a dependency of this feature.
- **Raw events expire; the count does not.** `post-view/retention.ts` drops events older than 90 days, while `post_view_total` is never pruned. Deleting a post cascades both.
- **It is dashboard-only.** `GetPostTraffic` is member-scoped and has no Public API or MCP projection. The public board's traffic is measured, not published.
- **It is not plan-gated.** ADR 0026 left the `analytics` capability for an owner decision; until that decision, every plan sees its own post's count.

## Why

ADR 0026 deferred views because they "need a privacy decision and a volume write on every read." This is that decision, made as small as possible: a page view is a count with four attributes, and nothing in the schema can be joined to a contact, a user, or a session. A visitor list is not a feature this design can grow into without a new decision.

The alternative was PostHog. It is not available: the dashboard's integration is deliberately `autocapture: false`, `capture_pageview: false`, strips URL-shaped properties, mounts only on `_dashboard.tsx`, and is absent entirely when `POSTHOG_KEY` is unset (self-host, local, tests). Using it would mean adding pageview instrumentation to the public board anyway, then putting a personal API key and cross-tenant HogQL queries in the request path of a customer-facing number, with retention and volume governed by a plan. A view count is a first-party fact; it belongs in the database that already knows the post.

The alternative for storage was an embedded analytical database (DuckDB, as tinytraffic uses). It is the wrong shape for a multi-tenant server: one writer per file, no transaction with the post lifecycle, and a second migration/backup/test story for a table that holds one row per post view. At the volume a feedback board produces, Postgres with one index answers the breakdown; if that ever stops being true, the upgrade is a daily rollup table, not a second database.

The counter is separate from the events because the two answer different questions. "How many views has this post ever had" must survive retention; "where did last month's views come from" is a window over events. Summing events for the counter would silently make the number shrink as retention ran.

## Consequences

- **The number is a popularity signal, not billing.** A determined caller can inflate it by posting the public endpoint; the bot filter, the post-visibility check, and the client-side session dedupe make casual inflation annoying, not impossible. Nothing downstream should treat it as an exact fact.
- **Self-host deployments without a country header get no country data.** That is the honest default; adding a GeoIP database is a dependency decision, not a code change.
- **The widget is not instrumented in v1.** Views are counted on the public board's post page. Counting the widget's own post detail is a later decision about whether the two surfaces share one number.
- **The ingest endpoint is public and unauthenticated.** It answers `accepted` whether it stored, rate-limited, deduplicated, or discarded a view, so it cannot be used to enumerate posts or private boards, or to read a limit's state. Its failures are logged and swallowed.
- **Per-visitor rate limiting needs a trusted proxy on both hops.** The relay derives the visitor address from `CF-Connecting-IP`, then `X-Real-IP`, then the first `X-Forwarded-For` entry, and forwards it in `X-Forwarded-For`; the API resolves it through `ClientIp` (`TRUSTED_PROXY_IPS`, or `TRUST_PROXY_HEADERS` behind a controlled network). On Cloudflare the edge overwrites `CF-Connecting-IP`, so that read is the visitor's address. In a self-hosted deployment those headers are only as trustworthy as the reverse proxy in front of the web app: it must set or overwrite them and must not pass client-supplied values through, or a visitor can choose its own rate-limit bucket and country. When the API's boundary is not configured the service still records views, but it skips the per-IP limit and stores no country rather than bucketing every customer under the relay's address.
- **Bot filtering is a user-agent policy.** A browser that lies, or a new crawler the regex does not know, is counted. The client also skips `navigator.webdriver`, which is what keeps the e2e suite out of the numbers.
- **A plan gate is still an open decision.** Adding `analytics` to `plan-entitlements.ts` and the pricing copy is an owner call with its own migration and communication; this ADR does not make it.
