# Product analytics: Databuddy

The dashboard's product analytics moved from PostHog to Databuddy. This note records what is preserved, what is deliberately different, and what still needs a decision. It is not a substitute for `packages/web-shared/src/lib/analytics-provider.tsx` (the event catalog) or `apps/web/src/dashboard/components/databuddy-provider.tsx` (the sink).

## The seam did not change

`AnalyticsProvider` / `setAnalyticsClient` / `trackEvent` and the typed `AnalyticsEvents` catalog are provider-agnostic and stayed as they were. Every call site still names one declaration in that catalog and gets a type error for an undeclared event or property. Only the sink changed: `posthogAnalyticsClient` became `databuddyAnalyticsClient`.

That means ~90 `trackEvent(…)` calls across the dashboard did not move, and a deployment that mounts no provider still gets a no-op.

## What maps to what

| PostHog | Databuddy |
| --- | --- |
| `POSTHOG_KEY` | `DATABUDDY_CLIENT_ID` |
| `POSTHOG_HOST` | `DATABUDDY_API_URL` (a first-party ingestion proxy; see "The collector is hosted only" below) |
| `posthog.capture(name, props)` | `track(name, props)` |
| `posthog.identify(id, { email, name })` | `identify(id, { email, name })` |
| `posthog.reset()` | `reset()` |
| `posthog.group("organization", id)` | `setGlobalProperties({ organization_id: id })` |
| `$pageview` + `pageContext` | the tracker's own pageviews, with `maskPaths` |
| `data-ph-block` | `data-replay-block` |

`@databuddy/sdk` also ships a PostHog-compatible adapter (`@databuddy/sdk/posthog`) that keeps PostHog's method names. It is deliberately not used: it rejects the privacy options the old wiring depended on, and its `startSessionRecording()` is a no-op, so it would have made the migration look smaller while moving the same decisions elsewhere.

## What is different, on purpose

**URLs reach the collector.** PostHog was configured to receive a route _category_ and never a URL. Databuddy's pageviews are path-based by design — that is what its Pages, Sources and funnel reports are built on. The mitigation is `maskPaths` in `apps/web/src/dashboard/components/databuddy-provider.tsx`: the leading segment (the organization id) is masked on every dashboard route, and the board, post, roadmap, company, contact, changelog, import and webhook slugs are masked by a specific pattern that runs first. Recorded paths keep their section names and depth. Query strings and fragments are never part of the recorded path, so an invitation token or an OAuth code cannot arrive that way. The list is hand-maintained; a new route with a dynamic segment is a new pattern.

**The workspace is a global property, not a group.** Databuddy's browser SDK has no group entity, so `organization_id` is attached to every event instead. It is an opaque id and `reset()` clears it, but it is a tenant identifier travelling with each event — the same exposure the old `group()` call had.

**Session replay is off.** The old wiring started recording only after a session was confirmed. Databuddy loads the recorder with `init()`, and `startSessionRecording()` is a no-op, so gating it means initialising the tracker after the session resolves — which tears the tracker down and records a second pageview for the landing route. Turning replay on here would also record `/register` and `/reset-password`, which live inside the dashboard boundary. Enabling it is a product decision, not a migration detail.

**The collector is hosted only.** Databuddy's documentation offers no way to self-host the service; the only self-hosting it describes is serving the _tracker script_ from your own domain (`scriptUrl`), which still sends events to Databuddy. So `DATABUDDY_CLIENT_ID` is the switch that makes this deployment a Databuddy customer: a self-hosted Feeblo that sets it is choosing a third-party data processor, and one that leaves it unset has no product analytics at all. `DATABUDDY_API_URL` exists for an operator who proxies `basket.databuddy.cc` through their own origin, not for a private collector.

**No property denylist.** Databuddy has no `property_denylist`, `before_send` or `persistence` equivalent. The catalog's property rules are the only control, so a sensitive value must never be _declared_ in `AnalyticsEvents`.

**Errors and Web Vitals stay with Sentry.** `autocapture` is off entirely, matching the old `capture_exceptions`/`capture_performance`/`autocapture` all off. `browser_operation_failed` is still emitted from `feeblo:operation-failed`, so the same failure appears in Sentry and in analytics with a shared `error_type`.

**Not `<DatabuddyProvider>`.** The React provider also mounts Databuddy's feature-flag manager, which fetches on mount with the signed-in user's email in its request context. This app uses no flags, so the tracker is started with `init()` and identity is synchronised by `./analytics-identity-machine` instead — one vendor endpoint, not two.

## Identity is a machine

`apps/web/src/dashboard/components/analytics-identity-machine.ts` declares what the tracker believes it is talking to. It replaces a `useRef` and an `if`/`else` chain that held the same lifecycle implicitly, with three traps worth a name:

- a cold anonymous load must not reset, or every page load mints a new anonymous id and one visitor arrives as many;
- a sign-out must reset exactly once, not once per re-resolution;
- a switch from one user to another must reset **before** identifying, or the second user's events land on the first user's profile.

The machine has two states — `unidentified` and `identified` — with the invariant `identified ⟺ context.identity !== null` pinned by a test that walks every state by every event. The same person with changed traits (a rename re-resolves the session) re-sends them without resetting; a different id forgets first. Effects are enqueued by the transition function, so the condition, the target and the two calls are in one place, and `analytics-identity-machine.test.ts` records them against an injected sink instead of mocking `@databuddy/sdk`.

## Open decisions

1. Session replay: on for every dashboard session with `replay: { maskText: true }`, or off until Databuddy exposes a post-identification start.
2. Whether `organization_id` on every event is acceptable, or analytics should drop the workspace dimension to match the "no tenant identifier" rule the old `pageContext` enforced for paths.
3. Historical data: Databuddy imports a PostHog batch export (pageviews and sessions only — custom events, recordings and profiles do not transfer). Whether to import is a data-ops call, not a code change.
