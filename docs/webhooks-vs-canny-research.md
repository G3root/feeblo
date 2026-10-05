# Feeblo webhooks vs Canny webhooks

**Question.** How is Feeblo's webhook integration different from Canny's? Primary reading: Feeblo's outbound custom-webhook system versus Canny's webhooks feature. Secondary reading, only where it changes the integration story: public API, self-hosting/open source, SDKs, and whether Canny gates webhooks/API behind a paid plan.

**Date.** 2026-10-05. All web pages were fetched and read on this date (UTC); the repo was read at commit `8707a5fa` (branch `webhook-new`, working tree clean apart from this file).

> **Update, same day.** Feeblo's payload was reshaped after this note was written: `post`/`status`/`previousStatus` became `objectType`/`object`/`changes`, `board.slug` became `board.url`, member `memberId` was dropped, and post content and author now travel on every event. See `docs/adr/0011-a-webhook-payload-is-a-safe-snapshot.md`. The Feeblo half below describes commit `8707a5fa`; the Canny facts are unaffected.

**Sources and method.** Feeblo facts come from this repository's code and docs (refs `F*`, listed at the end). Canny facts come only from first-party pages — `developers.canny.io`, `help.canny.io`, `canny.io` (refs `C*`). `developers.canny.io/api-reference` is JS-rendered: pages were loaded in a browser and read from the rendered DOM (`document.body.innerText`), and the rendered text was cross-checked against the server HTML payload. Claims that exist only in a secondary source are not used; claims that no first-party page states are listed under [Not verified](#not-verified).

---

## Short answer

1. **Canny covers the whole object lifetime; Feeblo V1 covers the post mutation only.** Canny documents 13 event types (post created/edited/deleted/tagged/status-changed/Jira-linked, comment created/edited/deleted, vote created/deleted). Feeblo emits exactly two — `feedback.post.created` and `feedback.post.status_changed` — plus a dashboard-only `webhook.test`. `post.edited`, all comment events and all vote events do not exist in Feeblo V1.
2. **Feeblo's payload is a small, deliberately versioned envelope; Canny's is the raw Canny object, unversioned.** Feeblo carries `type`, `version: 1`, `occurredAt`, `organizationId` and a nested `post`/`board`/`status`/`actor` projection that excludes post content by construction. Canny sends `{created, object, objectType, type}` where `object` is the full resource — for a post that includes `details` (the post body), `imageURLs`, the author's **email address**, `isAdmin`, and Canny's own admin URLs.
3. **Both payloads embed internal IDs and a link back to the object.** Feeblo sends `pst_…`/`brd_…`/`pss_…` ids plus an absolute public post URL and, for member-triggered events, `actor.memberId` and `actor.displayName`. Canny sends its own `id`s, `author.userID`, and `url` fields that point at the **admin** view (`…/admin/board/feature-requests/p/post-title`).
4. **The signing schemes are not comparable in strength.** Feeblo implements Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature`, HMAC-SHA256 over `id.timestamp.body`, so the body and the metadata are both authenticated. Canny signs **only the nonce** with the team's API key: its published verification function `HMAC-SHA256(apiKey, canny-nonce).base64` never touches the request body, so the body is not covered by the signature.
5. **Feeblo's secret is per-endpoint and rotatable with a documented 24-hour dual-sign grace period.** Canny's signing key _is_ the team-wide secret API key (the same key that authorises every API call), and no first-party page documents rotating it or signing with two keys.
6. **Retries exist and are specified on Feeblo; they are undocumented on Canny.** Feeblo: at-least-once, 7 total attempts on a jittered ~1 min / 5 min / 30 min / 2 h / 8 h / 24 h schedule, retry on transport failure/timeout/ 408/409/425/429/5xx, everything else 3xx/4xx terminal, `Retry-After` honoured up to 24 h, no redirects. Canny's API reference contains no mention of webhook retries, attempt counts, timeouts or redirect policy — the only `Retry-After` in its docs is the REST API rate limit.
7. **Feeblo is hardened against SSRF by default and documents it; Canny documents no endpoint policy.** Feeblo requires HTTPS in production, rejects credentials/fragments/localhost/private/reserved/cloud-metadata targets, re-resolves DNS and pins the address for every delivery, caps the body at 256 KiB and the request at 10 s. The equivalent Canny behaviour is unknown from first-party docs.
8. **Feeblo gives operators a delivery surface; Canny's docs stop at the settings form.** Feeblo has a delivery history, manual retry, pause/resume, a signed dashboard test delivery, 30-day retention, and automatic pausing after 10 consecutive exhausted deliveries. Canny documents only that you enter URLs at _Your Subdomain > Settings > API_.
9. **Canny's API and webhooks are on all plans today; Feeblo gates both.** Canny's pricing matrix marks the **"API & webhooks"** row as included on Free, Pro and Business, and its help centre says the API "is available to accounts on all plans". Feeblo's Public API is Starter+ (server-enforced `403 PLAN_REQUIRES_UPGRADE`) and the dashboard locks integrations on Free (a UI-level upsell). Canny's _MCP server_, by contrast, needs Pro or Business.
10. **Feeblo is AGPL-3.0 and self-hostable; Canny is closed SaaS.** Feeblo ships Docker images and a Compose stack in-repo, so an integration team can audit and run the delivery kernel itself (and a development-only private network override lets receivers live on a local network). Canny's webhook implementation is entirely opaque.

### Where the two are the same

- Webhooks are configured in the product UI, not through the API, on both sides; no API endpoint creates or edits a webhook.
- Configuring webhooks requires the top role: Feeblo's `webhooks.manage` is Admin/Owner only, Canny's "Manage webhooks" is Owner only.
- Neither publishes a webhook-consumer SDK package. Feeblo points consumers at the community `standardwebhooks` library; Canny pastes verification functions in seven languages (Node.js, C#, Go, Java, PHP, Python, Ruby) into its docs.
- Neither documents a generic _inbound_ webhook receiver. Feeblo's provider declares `inboundHandlers: []` and calls an inbound _Inbox Event_ a future concept; Canny's answer to inbound is the REST API, Autopilot, Zapier, MCP, a browser extension and CSV import.

---

## Comparison table

Feeblo evidence refs `F*` and Canny refs `C*` are defined under [Sources](#sources).

| # | Dimension | Feeblo | Canny | Evidence |
| --- | --- | --- | --- | --- |
| 1 | Documented event types | 2 subscribable (`feedback.post.created`, `feedback.post.status_changed`) + a route-ineligible `webhook.test` | 13 (`post.*` × 8, `comment.*` × 3, `vote.*` × 2) | `F1`,`F11` / `C1` §Event types |
| 2 | Event payload envelope | `{id, organizationId, type, version: 1, occurredAt, post, board, status, previousStatus?, actor}` | `{created, object, objectType, type}` — bare event object, no version field | `F2`,`F3` / `C1` §The event object |
| 3 | Version field / wire versioning | Explicit integer `version: 1`; `id` is the immutable event id (`iev_…`) | None documented | `F2`,`F3` / `C1` §The event object (no `version` key; the API reference contains no occurrence of the word "version") |
| 4 | Object link back | `post.url` — absolute public URL | `object.url` — admin view URL, plus `board.url`, `author.url` | `F2` / `C1` §Example event object |
| 5 | Actor identity in the payload | `actor.type` (`member`/`end_user`); `memberId` + `displayName` added only for member actors | Full `author` user object: `id`, `email`, `isAdmin`, `name`, `url`, `userID` | `F3`,`F4` / `C1` §Example event object |
| 6 | Post content in the payload | Excluded by schema (no `description`/body field) | Included — `details` is the post body, plus `imageURLs` | `F2`,`F3` / `C1` §Example event object |
| 7 | Signature headers | `webhook-id`, `webhook-timestamp`, `webhook-signature` (+ `x-feeblo-event`, `User-Agent: Feeblo-Webhooks/1`) | `canny-timestamp`, `canny-nonce`, `canny-signature` | `F1`,`F5` / `C1` §Webhook signatures |
| 8 | What is signed | `id.timestamp.body` (HMAC-SHA256, Standard Webhooks `v1`), i.e. body **and** metadata | The nonce only: `HMAC-SHA256(teamApiKey, canny-nonce)`, Base64 | `F5`,`F1`,`SWH` / `C1` §Webhook signatures |
| 9 | Signature timestamp semantics | Attempt-local, regenerated per attempt (replay protection with the stable id) | Milliseconds since epoch, "to avoid replayed requests"; no tolerance window documented | `F1`,`F5` / `C1` §Webhook signatures |
| 10 | Secret model and rotation | Per-endpoint `whsec_` secret, 32 random bytes, shown once, rotated in the dashboard; both new and previous keys sign for 24 h | The team's secret API key; no rotation or dual-signing documented | `F1`,`F5` / `C1` §Webhook signatures |
| 11 | Retry policy | At-least-once; 7 attempts total; jittered ≈1 m/5 m/30 m/2 h/8 h/24 h; retry on transport failure, timeout, 408, 409, 425, 429, 5xx | Not documented | `F1`,`F8` / `C1` (no webhook retry documentation) |
| 12 | `Retry-After` handling | Parsed from delay-seconds or IMF-fixdate, **capped at 24 h**, used if later than the scheduled backoff | Not documented for webhooks | `F8` / `C1` |
| 13 | Request timeout | 10 s (`WEBHOOK_REQUEST_TIMEOUT_MS = 10_000`) | Not documented | `F7` / `C1` |
| 14 | Redirect policy | Not followed; a 3xx is classified terminal | Not documented | `F1`,`F8` / `C1` |
| 15 | Payload size cap | 256 KiB, enforced before a socket opens | Not documented | `F7` / `C1` |
| 16 | Endpoint restrictions | HTTPS required in production; no credentials/fragment; no localhost, private/reserved ranges, NAT64, link-local, cloud metadata; DNS re-resolved and pinned per delivery; dev-only private-network override | Not documented | `F1`,`F9` / `C1` |
| 17 | Delivery guarantee | "Delivery is at least once" — durable delivery row committed with the domain mutation | Not documented | `F1`,`F12` / `C1` |
| 18 | Idempotency / dedupe key | Stable delivery id in `webhook-id`; documented as the idempotency key; DB uniqueness on `(route, event, actionKey)` | None documented. `canny-nonce` is explicitly "unique per request", so it is not a per-event key | `F1`,`F10` / `C1` §Webhook signatures |
| 19 | Delivery visibility / ops | Delivery history, manual retry, pause/resume, signed dashboard test, 30-day retention, auto-pause after 10 consecutive exhausted deliveries, backlog/latency/lease metrics | Only the settings page where URLs are entered | `F6`,`F13`,`F14` / `C1` §Webhooks |
| 20 | Configuration surface | Dashboard settings page over authenticated RPC (`WebhookEndpointList/Create/Update/Pause/Resume/Remove`, `WebhookSecretRotate`, `WebhookTestDelivery`, `WebhookDeliveryHistory`, `WebhookDeliveryRetry`) | Product UI only: _Your Subdomain > Settings > API_ | `F15`,`F1` / `C1` §Webhooks |
| 21 | Who may configure | `webhooks.manage` → Admin/Owner (Contributor, Manager: no) | "Manage webhooks" → Owner (Contributor, Manager: no) | `F16` / `C4` |
| 22 | API auth model for the surrounding platform | `x-api-key` org-owned key `fbk_…`, 30 named scopes, 300 req/min per key, MCP shares the key and scopes | One team-wide secret API key in a POST `apiKey` field, no scopes, plan-dependent rate limits (Free 5 rps / 10 rps legacy / 20 rps Business) | `F17` / `C1` §Authentication, §Rate limits |
| 23 | Plan gating of API + webhooks | Public API: Starter+ (`403 PLAN_REQUIRES_UPGRADE`), server-enforced. Integrations: `integrations: false` on Free, `true` on Starter/Professional; enforced in the dashboard UI lock | "API & webhooks" checked on Free, Pro and Business; help centre: "The API is available to accounts on all plans" | `F18`,`F19`,`F20` / `C2`,`C3` |
| 24 | Related paid gates | — | Zapier: Pro (or legacy Growth) and Business; MCP connectors: Pro or Business | `C5`,`C8` |
| 25 | Inbound webhooks | Not implemented for custom webhooks (`inboundHandlers: []`); inbound events are a future concept; the GitHub provider has a provider-specific inbound App webhook | No inbound webhook endpoint documented; inbound means API / Autopilot / Zapier / MCP / browser extension / CSV | `F11`,`F21` / `C6` |
| 26 | Open source / self-host | AGPL-3.0, Docker images published to GHCR, root `docker-compose.yml`, dev Compose stack | Closed hosted SaaS | `F22` / `C7` (Canny is a hosted product with no self-host docs) |
| 27 | SDK story | `@feeblo/sdk` / `@feeblo/sdk-react` embed the feedback widget and identify users; no webhook verification package | `sdk.canny.io/sdk.js` embeds and identifies users; verification code is copy-pasted from docs in 7 languages; no webhook package | `F23` / `C1`,`C8` |

---

## 1. Event catalogue

**Feeblo.** Two subscribable events, declared once in `packages/domain-contracts/src/integration.ts`:

```ts
export const SUBSCRIBABLE_INTEGRATION_EVENT_TYPES = [
  "feedback.post.created",
  "feedback.post.status_changed",
] as const;
```

A third type, `webhook.test`, exists in `IntegrationEventType` (the value stored in `integration_event.type`) but is deliberately not subscribable. `docs/webhooks.md` (F1) states it plainly:

> "V1 emits `feedback.post.created` and `feedback.post.status_changed`. A dashboard test uses `webhook.test`; it follows the real delivery/signing path but cannot be selected by a route."

`docs/adr/0001` (F12) records the scope decision:

> "V1 initially shipped only signed outbound custom webhooks. Inbox events and post-to-external-resource bindings arrived with the GitHub provider…"

The same two events feed the Slack, Discord and GitHub outbound capabilities, so "add an event type" is a kernel-level change, not a per-provider one.

**Canny.** The API reference's _Event types_ section (C1, anchor `#event_types`) opens with:

> "This is a list of all types of events we send."

and then lists 13 events with their trigger conditions, verbatim:

| Event | Trigger sentence as documented |
| --- | --- |
| `post.created` | "Occurs when a new post is created." |
| `post.edited` | "Occurs when a post is edited." |
| `post.deleted` | "Occurs when a post is deleted." |
| `post.jira_issue_linked` | "Occurs when a Jira issue is linked to a post." |
| `post.jira_issue_unlinked` | "Occurs when a Jira issue is unlinked from a post." |
| `post.tag_added` | "Occurs when a post is tagged" |
| `post.tag_removed` | "Occurs when a post's tag is removed." |
| `post.status_changed` | "Occurs when a post's status is changed." |
| `comment.created` | "Occurs when a new portal comment is created." |
| `comment.edited` | "Occurs when a portal comment is edited." |
| `comment.deleted` | "Occurs when a portal comment is deleted." |
| `vote.created` | "Occurs when a user votes on a post." |
| `vote.deleted` | "Occurs when a user unvotes on a post." |

The help-centre article _The Canny API_ (C2, written 2024-05-07) publishes a shorter list of 9 events and omits `post.edited`, `post.tag_added` and `post.tag_removed`, so the developer docs are the current catalogue and the help article is the older, narrower one.

**Difference that matters:** a Canny user migrating to Feeblo loses comment and vote events entirely and post edits/tag changes. Conversely, Feeblo's `previousStatus` gives a status transition in one message where Canny's `post.status_changed` event carries the object with its new status, so a consumer must diff against its own state.

## 2. Payload and versioning

**Feeblo.** `docs/webhooks.md` (F1):

> "Each external payload is versioned and includes `id`, `organizationId`, `type`, `version`, and `occurredAt`. It contains the post ID/title/absolute URL/current status, board ID/name/slug, optional previous status, and an actor classification. It excludes post content, email addresses, credentials, and private organization data."

`integrations/webhook/src/webhook-payload.ts` (F3) is the enforcing schema — the `version` field is `Schema.Literal(1)`, the payload has no body/description field, and the actor block is:

```ts
actor: Schema.Struct({
  type: WebhookActor,                       // Schema.Literals(["member", "end_user"])
  memberId: Schema.optionalKey(Schema.String),
  displayName: Schema.optionalKey(Schema.String),
}),
```

`integrations/webhook/src/webhook-provider-registration.ts` (F4) builds the wire object from the internal event and adds `memberId`/`displayName` **only when the actor is a member**; the doc's example shows the `end_user` shape (`"actor": { "type": "end_user" }`). So the minimisation claim is accurate about post content and email, but the payload does carry an internal member id and a display name for member-triggered events.

The payload's `id` is the **event** id (`iev_…`), which is stable across routes; the per-route, per-attempt-stable identifier is the `webhook-id` header (the delivery id).

**Canny.** The event object is four documented attributes (C1, `#webhooks`):

> "created — Time at which the event was created, in ISO 8601 format." "object — The object the event is about." "objectType — The type of object included in the event." "type — The type of event."

The documented example is a bare event object with no wrapper and no version:

```json
{
  "created": "2017-07-15T22:11:00.000Z",
  "object": {
    "id": "6a2889c586d7b8843bf4cf05",
    "author": {
      "id": "6a2889c586d7b8843bf4cf07",
      "created": "2017-07-15T22:11:00.000Z",
      "email": "test@test.test",
      "isAdmin": false,
      "name": "Sally Doe",
      "url": "https://your-company.canny.io/admin/users/sally-doe",
      "userID": "1234"
    },
    "board": {
      "id": "…",
      "created": "…",
      "name": "Feature Requests",
      "postCount": 123,
      "url": "https://your-company.canny.io/admin/board/feature-requests"
    },
    "commentCount": 10,
    "created": "2017-07-15T22:11:00.000Z",
    "details": "Test post details",
    "eta": "February 2020",
    "imageURLs": ["…"],
    "score": 72,
    "status": "in progress",
    "title": "An awesome feature request",
    "url": "https://your-company.canny.io/admin/board/feature-requests/p/post-title"
  },
  "objectType": "post",
  "type": "post.created"
}
```

Observations from that example, all citable from the same page:

- The payload embeds the **post body** (`details`) and image URLs — Feeblo deliberately strips post content.
- The payload embeds the author's **email address** and admin flag — Feeblo sends only an actor _class_, and the vendor docs state email is excluded.
- `url` values point at the **admin** board/user views, not the public portal; Feeblo's `post.url` is the public post URL.
- There is **no version attribute** anywhere in the object, and Canny's API reference contains no occurrence of the word "version" at all (checked against the rendered text). Wire-format versioning is therefore undocumented. Note that the _REST_ API is versioned in its URLs (`/api/v1/…`, `/api/v2/…`), which is a separate concern from payload shape.
- The page does not document which HTTP method, content type, or envelope carries the event object, nor whether `object` has a different shape for `objectType` values other than `post`.

### Field-by-field

Feeblo fields are the `WebhookExternalPayload` struct (F3) plus the `docs/webhooks.md` example (F1); Canny fields are the `post.created` example on C1.

| Concept | Feeblo | Canny |
| --- | --- | --- |
| Event id | `id` (`iev_…`), top level, immutable | none — `canny-nonce` is per-request only |
| Event type | `type: "feedback.post.created"` | `type: "post.created"` + `objectType` |
| Occurred at | `occurredAt` | `created` |
| Version | `version: 1` (a `Schema.Literal`) | absent |
| Tenant | `organizationId` | absent (implied by the endpoint) |
| The object | `post` projection: `{id, title, url}` | `object` = the whole post |
| Board | `board: {id, name, slug}` | `object.board: {id, created, name, postCount, url}` |
| Status | `status: {id, type: "PENDING"}` + `previousStatus` on a change | `object.status: "in progress"` (label only, no id, no prior value) |
| Author | `actor.type: "member" \| "end_user"`; `memberId`/`displayName` only for member actors | `object.author: {id, created, email, isAdmin, name, url, userID}` |
| Links | `post.url` → public portal post | `object.url` → admin view |
| Delta | `previousStatus` names the transition | none — the consumer must diff against its own state |

The structural consequences:

- **Envelope vs raw resource.** Feeblo's metadata (`type`, `version`, `occurredAt`, `organizationId`) sits outside the object; Canny's `object` is the resource serialized as-is, so a consumer is coupled to Canny's post/comment/vote object schemas. Feeblo's status enum (`PENDING`/`REVIEW`/`PLANNED`/`IN_PROGRESS`/`COMPLETED`/`CLOSED`, F29) is machine-readable where Canny's is free text.
- **Minimisation is structural.** The schema has no body, image, score, email, `isAdmin` or author `userID` field, so the omissions are enforced, not promised; Canny's example carries all of them, including the author's email and the external `userID` set through its SDK.
- **Tenant routing.** `organizationId` lets one receiver serve several workspaces; Canny's payload carries no team identifier.

## 3. Signing and verification

**Feeblo.** `docs/webhooks.md` (F1):

> "Requests use the Standard Webhooks headers `webhook-id`, `webhook-timestamp`, and `webhook-signature`, plus `x-feeblo-event` and `User-Agent: Feeblo-Webhooks/1`. `webhook-id` is the stable delivery ID; the timestamp and signature are regenerated for every attempt. Verify the exact raw request bytes before JSON parsing."

and the recommended verification is the community library:

```ts
const event = webhook.verify(rawBody, {
  "webhook-id": request.headers.get("webhook-id")!,
  "webhook-timestamp": request.headers.get("webhook-timestamp")!,
  "webhook-signature": request.headers.get("webhook-signature")!,
});
```

`integrations/webhook/src/webhook-signing.ts` (F5) implements that with the `standardwebhooks` package: it generates a `whsec_`-prefixed, 32-byte base64 secret, and signs with `new Webhook(secret).sign(deliveryId, signingDate, rawBody)` for the current key plus, while unrotated-expiry has not passed, the previous key — the two signatures are space-joined in `webhook-signature`. `webhook-id` is the delivery id, so the id is stable across attempts while the timestamp and signature are attempt-local.

The scheme's own specification defines the signed content (SWH):

> "The content to be signed is therefore: `msg_id.timestamp.payload`."

so body and metadata are both authenticated.

> Caveat: this checkout has no `node_modules`, so I read the library's call sites rather than its source. The `id.timestamp.body` construction and the `v1,`-prefixed base64 serialization are the Standard Webhooks specification's, which Feeblo's own doc names.

**Canny.** The API reference (C1, `#webhook_signature`):

> "Canny signs all the webhooks it sends. Each request will include the following headers."

| Header | Documented meaning |
| --- | --- |
| `canny-timestamp` | "The number of milliseconds since the UNIX epoch. Use this field to avoid replayed requests." |
| `canny-nonce` | "A random string, unique per request." |
| `canny-signature` | "An HMAC (SHA-256) signature of the nonce, using your team's API key, encoded in Base64" |

and the verification instruction:

> "You can verify a request originated from Canny by using your team's API key to verify the signature sent in the canny-signature header, by signing the nonce in canny-nonce. The nonce is signed using SHA-256 and is Base64 encoded."

Canny publishes the verification function in tabs for Node.js, C#, Go, Java, PHP, Python and Ruby. The Node.js one is the whole algorithm, and it only ever signs the nonce:

```js
const calculated = crypto
  .createHmac("sha256", APIKey)
  .update(nonce)
  .digest("base64");
return signature === calculated;
```

Consequences, all derivable from the documented function:

- **The body is not authenticated.** Any party able to modify the request in flight (or a mistaken proxy) can change the JSON while keeping `canny-nonce`/`canny-signature` valid, and the published check still returns `true`.
- **`canny-timestamp` is not authenticated either.** It is documented as replay protection but is not an input to the signature, so it must be validated separately and there is no documented tolerance window.
- **The signing secret is the API key.** Rotating it rotates every API integration at once, and no first-party page documents rotation or a dual-key grace period.
- The comparison is a plain string equality (`signature === calculated`) rather than a constant-time comparison, which the docs do not address.

## 4. Retries

**Feeblo.** `docs/webhooks.md` (F1):

> "Delivery is at least once. Treat the stable `webhook-id` as an idempotency key and return any 2xx after successful processing. Transport failures, timeouts, 408, 409, 425, 429, and 5xx retry with bounded jitter approximately after 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours, and 24 hours; other 3xx/4xx are terminal. A valid `Retry-After` on 429 is honored up to 24 hours. Feeblo does not follow redirects."

The code matches exactly. `integrations/core/src/delivery-policy.ts` (F8):

```ts
const retryableHttpStatuses = new Set([408, 409, 425, 429]);
const retryDelaysMs = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  8 * 3_600_000,
  24 * 3_600_000,
] as const;

/** Total attempts include the immediate request plus the six scheduled retries. */
export const maxIntegrationDeliveryAttempts = retryDelaysMs.length + 1;

/** The maximum valid Retry-After honored by the V1 delivery scheduler. */
export const maxIntegrationRetryAfterMs = 24 * 3_600_000;
```

Jitter is bounded to ±20 % of the base delay (`Math.min(Math.max(jitterRatio, -0.2), 0.2)`), and a receiver-requested `Retry-After` can only _extend_ the wait, never shorten it below the scheduled backoff (`Math.max(jitteredDelayMs, boundedRetryAfterMs)`). `Retry-After` accepts delay-seconds or an RFC 7231 IMF-fixdate, bounded to one day (F7). Typed provider failures map to the same decision: rate-limit → retry, temporary → retry, authentication/invalid-configuration/permanent-rejection → terminal.

**Canny.** Nothing. Across the entire rendered API reference there are zero occurrences of "retries", "timeout", "delivery", "attempt" or "idempot", and the three occurrences of "retry" are all about the REST API's rate limiting:

> "Requests are counted per API key across every endpoint, in one-second, one-minute and one-hour windows. The allowance depends on your plan." "Every response includes headers describing the window closest to its limit. When a limit is exceeded the request is not processed and the response has status 429 with a Retry-After header."

The help centre has no article for the webhook settings page either (`help.canny.io/en/search?q=webhook` returns only the API article, the Zapier article, the Teams article, the "tools without a native integration" article and the admin-roles article). So on first-party evidence, Canny's webhook retry behaviour, attempt count, backoff, timeout, terminal status codes and redirect policy are **all undocumented**.

## 5. Endpoint policy (HTTPS, private networks, DNS)

**Feeblo.** `docs/webhooks.md` (F1):

> "Production endpoints must be HTTPS, with no credentials or fragments, and must resolve to public addresses. Localhost, private/reserved networks, and cloud-metadata destinations are rejected. DNS is revalidated and pinned for every delivery. A development-only private-network override exists solely for local receivers. Deployments should also deny private-network and cloud-metadata egress at the infrastructure layer. Configure receivers to accept only intended public traffic and validate signatures on every request."

`integrations/webhook/src/webhook-endpoint-security.ts` (F9) is the implementation: a `BlockList` for IPv6 (unspecified, loopback, NAT64 well-known and local-use, discard-only, IETF protocol assignments, documentation, 6to4, unique-local, link-local, site-local, multicast) plus an explicit IPv4 predicate (0/8, 10/8, 127/8, ≥224, 100.64/10, 169.254/16, 172.16/12, 192.0.0/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24), canonicalisation of IPv4-mapped IPv6 spellings so every form classifies the same, and:

```ts
/** Resolves every address before use and pins only validated addresses to prevent DNS rebinding after endpoint validation. */
```

Failures are distinct strings (`"Webhook endpoint must use HTTPS in production"`, `"Webhook endpoint cannot include credentials or a fragment"`, `"Webhook endpoint cannot target localhost"`, `"Webhook endpoint cannot target a private or reserved address"`, `"Webhook endpoint hostname resolved to a private or reserved address"`). The transport (F7) additionally pins the agent's DNS lookup to the validated addresses, disables keep-alive, caps the body at 256 KiB before a socket opens, times out at 10 s, and drops response bodies without retaining them.

**Canny.** No first-party page states any of this. The API reference's webhook section gives the settings location and the signature scheme, and the help article says only:

> "You can set up webhooks for your account in the API & Webhooks settings page."

There is no statement about HTTPS, private/reserved address blocking, DNS re-resolution, redirect following, request timeout, or payload size.

## 6. Delivery guarantee, idempotency and operational surface

**Feeblo.** The guarantee is a design consequence, not a best-effort send. `docs/adr/0001` (F12):

> "Feeblo records integration events and matching durable deliveries in the same database transaction as the domain mutation." "The transaction ends before any provider request. This yields at-least-once delivery: a crash after remote acceptance and before local acknowledgement can cause a duplicate, so consumers must deduplicate with the stable delivery ID."

The delivery row is unique on `(route, event, actionKey)` where `actionKey` is the "Stable outbound action identity; V1 derives it from the route and event" (`packages/db/src/schema/integration.ts`, F10), and the delivery id is what `webhook-id` carries. Attempts are recorded append-only with "safe attempt diagnostics; response bodies and secrets are excluded" (F11). Operators get (F15) `WebhookDeliveryHistory` and `WebhookDeliveryRetry` alongside the create/update/pause/resume/remove/rotate/test RPCs. `docs/integrations.md` (F13) states:

> "Retention cleanup runs hourly and removes V1 events, deliveries, and attempts after 30 days, then purges archived endpoint metadata."

and that the server exports "delivery backlog, claimed backlog, provider latency/outcome, lease-recovery age/count, and automatic-pause metrics". The automatic pause triggers after 10 consecutive exhausted deliveries (`integrations/core/src/integration-delivery-postgres-repository.ts`, F14: `if ((connection?.exhaustedCount ?? 0) < 10) { return; }` then sets `lifecycle: "paused"`); the threshold is in code, not in the docs.

**Canny.** No delivery guarantee, no idempotency key, no delivery log and no manual retry are documented. The only per-request identifier is `canny-nonce`, and the docs define it as "unique per request" — which is the opposite of a per-event idempotency key, since a retry would carry a new nonce. `docs/webhooks.md`'s instruction ("Treat the stable `webhook-id` as an idempotency key") has no counterpart in Canny's docs.

## 7. Configuration and auth

**Feeblo.** Webhooks are configured from the dashboard settings page `/$organizationId/settings/webhooks` (F24) over the session-authenticated RPC group `WebhookManagementRpcs` (F15), and the RPC handlers (F25) wrap every call in the named permission:

```ts
const authorize = (organizationId: string) =>
  Policy.withPolicy(Policy.canPermission(organizationId, "webhooks.manage"));
```

`docs/permissions.md` (F16) puts that permission at Admin/Owner:

> "| Developer | Manage API/SSO keys or webhooks | No | No | Yes |"

(columns: Contributor / Manager / Admin-Owner), and notes "outbound webhook management uses the named `webhooks.manage`". Endpoint URLs and signing secrets are encrypted at rest as connection credentials — the schema holds `credentials_ciphertext` (F10), the management service writes it through `encryptWebhookCredentialMaterial` (F28), and the provider manifest says "The endpoint is encrypted before persistence" (F27). The manifest describes the connection mode as `none` and declares exactly one capability, `events.post` (outbound) with `configVersion: 1`. Routes select event types from the subscribable list.

**Canny.** Configuration is UI-only, at _Your Subdomain > Settings > API_, and is Owner-only. The API itself has no webhook endpoints — you cannot create or edit a webhook through `apiKey` calls. Canny's auth model (C1 §Authentication):

> "API requests must be authenticated by including your secret API key. You can find your secret API key in your company settings. This key is secret! Store it on your server and don't share it." "You can include your secret API key in a request by adding it as a POST parameter with key apiKey."

One key per team, no scopes or per-key permissions, and the same key signs webhooks. Rate limits are per key and plan-dependent (C1 §Rate limits): Business "20 requests per second, 600 per minute, 15,000 per hour"; "Core, Starter, Growth, Pro" 10/s, 300/min, 5,000/h; Free 5/s, 100/min, 1,000/h, with per-IP counting too: "Requests are also counted per IP address, with the same allowance as a Business key."

Feeblo's Public API (F17) is the mirror image: `x-api-key: fbk_…`, an org-owned key, 30 named scopes granted at creation, per-key limits ("Limits are per key, not per IP, and are shared across server instances: **300 requests per minute**, shared by reads and writes"), and an MCP surface at `POST /mcp` that reuses the same key and scopes. It cannot configure webhooks — there is no webhook scope or endpoint.

## 8. Plan gating

**Canny.** On `canny.io/pricing` (C3, accessed 2026-10-05), the _Idea Management_ section of the comparison table has a row labelled **"API & webhooks"**, and that row carries a check mark in **all three** columns. Column order was verified from the same table's header ("Free $0/mo billed yearly", "Pro $79/mo billed yearly", "Business Custom") and the `Tracked users` row (25 / 100+ / Custom). The help centre (C2) is explicit:

> "Canny does have a public, open API. The API is available to accounts on all plans and can be used to create integrations with other tools."

The _Canny's billing plans_ article (C9) is consistent with that for the API — "While basic API operations, such as creating posts, are supported, custom fields cannot be included on post creation if you're on the Free plan" — and says of integrations:

> "Only Feedback and Notification integrations can be connected on the Free plan"

with no mention of webhooks. It does list the Free plan's other limits (25 tracked users, 5 Owners/Managers). Things Canny _does_ gate: **Zapier** — "The Zapier integration is only available on the Pro (or legacy Growth) and Business plans" (C5) — and **MCP connectors** — "Your workspace needs both of these: A Pro or Business plan. Teams on other plans will see "Current plan does not support MCP connectors" when connecting." (C8). Rate limits differ by plan even where the feature is present, including a distinct Free tier (5 req/s).

**Feeblo.** Both surfaces are gated, and only one of them server-side. `packages/domain/src/plan-entitlements.ts` (F18) defines `integrations` and `publicApi` as capabilities with `free: false/false`, `starter: true/true`, `professional: true/true`. The Public API gate is enforced on every key-check (`packages/domain/src/api-key/policies.ts` → `canUsePublicApi`), and `docs/public-api.md` (F19) documents the result:

> "The Public API is included in **Starter** and **Professional**. A workspace on the Free plan cannot create keys, and requests made with keys from a workspace that has downgraded return `403 PLAN_REQUIRES_UPGRADE`."

The webhook/`integrations` gate is **presentational** at HEAD: a tree-wide grep for `capabilities.integrations` returns exactly one hit, the dashboard card (F20, `integration-card.tsx:189`), which resolves the primary action to `"locked"` for a Free workspace; the webhook RPC handlers and the live management service contain no entitlement check (they authorise `webhooks.manage` only). So on the Free plan the UI shows an upgrade lock while the RPC layer itself does not refuse the call.

## 9. Open source, self-hosting, SDKs

**Feeblo.** `README.md` (F22):

> "Open-source customer feedback platform — collect feature requests, roadmaps, changelogs, and an embeddable feedback widget." "Licensed under the [GNU AGPL-3.0](./LICENSE)."

Production deployments use "the Docker images referenced in `docker-compose.yml` (`ghcr.io/g3root/feeblo-server` and `ghcr.io/g3root/feeblo-web`)", and the dashboard can also be deployed to Cloudflare. That makes the webhook sender — signature construction, endpoint validation, retry classification — auditable and self-run, including the development-only private-network override that lets receivers sit on a local network. The published SDKs are widget SDKs (`@feeblo/sdk`, `@feeblo/sdk-react`: "Embeddable feedback widget SDK", "identify your users, and listen for widget events"), not webhook consumers; Feeblo's docs point consumers at the community `standardwebhooks` library.

**Canny.** Hosted SaaS. `canny.io/sitemap.xml` lists 91 URLs — product, pricing, integrations, feature, compare, case-study, about/careers/security/legal pages — and none of them is a self-hosting, source-availability or download page. Canny's JavaScript SDK (`sdk.canny.io/sdk.js`, C8) is likewise an embed/identify SDK — the docs' privacy framing is close to Feeblo's: "Install our JavaScript SDK to identify your users. This way, when they leave feedback on Canny, it'll be tied to their existing user account in your application." Canny's advantage on the consumer side is doc ergonomics: seven language tabs for signature verification rather than a pointer to one package.

---

## Not verified

Facts I could not source first-hand. Each names the page or API that would settle it.

1. **Whether Canny retries webhook deliveries at all** — attempt count, backoff, terminal statuses, per-attempt timeout, redirect policy, and what happens after final failure. Settled by the _API & Webhooks_ settings page inside a live Canny account (`Your Subdomain > Settings > API`) and/or a support answer; nothing on `developers.canny.io/api-reference` or `help.canny.io` states it.
2. **Whether Canny enforces endpoint restrictions** — HTTPS-only, private/reserved-network blocking, DNS rebinding defence, allowed ports. The settings page is the only place that might say so; it is undocumented.
3. **Whether Canny's webhook secret can be rotated** and whether rotation is graceful. The secret is _defined_ as the team API key (C1), but rotation is not documented. The API & Webhooks settings page would show it.
4. **The Canny wire format beyond the body**: HTTP method, content type, whether the event is wrapped in an envelope, and whether a delivery id or attempt counter is sent in a header. The docs list only the three `canny-*` headers.
5. **Canny's `object` shape for non-post events** (`comment.*`, `vote.*`, the four `post.jira_*`/tag events and `post.edited`/`post.deleted`). Only the `post.created` example is published; the per-resource objects exist on the same page but are not presented as webhook payloads. Settled by capturing a live delivery.
6. **Whether Canny caps or filters webhooks per plan** (endpoint count, event selection per endpoint, board filtering). The pricing matrix says the feature is included on Free; no limits are documented. The one related first-party statement is about the old Free plan and the API, in C2.
7. **Legacy Canny plans** (Core, Starter, Growth) — the rate-limit table still lists them, so webhook/API availability on grandfathered accounts may differ from the current Free/Pro/Business matrix. Only Canny can confirm per-account.
8. **Whether Canny's help-centre event list (9 events) or the API reference's (13) is authoritative** for a given account. The API reference is the newer, longer list; the help article is dated 2024-05-07.
9. **Feeblo's exact signature string** — I could not execute `webhook-signing.ts` (no `node_modules` in this checkout), so the `v1,<base64>` serialization and the `id.timestamp.body` construction come from the Standard Webhooks specification the doc names, not from an observed request. A capture against `integrations/webhook/src/test-server.ts` would settle it.
10. **Whether Feeblo intends to close the event-catalogue gap** (`post.edited`, comment and vote events) — the repo's own docs describe V1 as two events, and `docs/adr/0001` frames the rest as future work. A roadmap document, not the code, would answer it.

---

## Sources

### Feeblo (this repository, branch `webhook-new`)

| Ref | Source |
| --- | --- |
| F1 | `docs/webhooks.md` |
| F2 | `docs/webhooks.md` §Signing and verification / payload example |
| F3 | `integrations/webhook/src/webhook-payload.ts` |
| F4 | `integrations/webhook/src/webhook-provider-registration.ts` |
| F5 | `integrations/webhook/src/webhook-signing.ts` |
| F6 | `docs/integrations.md` §Operations |
| F7 | `integrations/webhook/src/webhook-transport.ts` |
| F8 | `integrations/core/src/delivery-policy.ts` |
| F9 | `integrations/webhook/src/webhook-endpoint-security.ts` |
| F10 | `packages/db/src/schema/integration.ts` (`integration_delivery_route_event_action_uidx`) |
| F11 | `integrations/core/src/integration-contracts.ts`; `packages/domain-contracts/src/integration.ts` |
| F12 | `docs/adr/0001-transactional-integration-events-and-provider-adapters.md` |
| F13 | `docs/integrations.md`; `integrations/core/src/delivery-worker-defaults.ts` |
| F14 | `integrations/core/src/integration-delivery-postgres-repository.ts` |
| F15 | `packages/domain/src/integration/rpcs.ts` |
| F16 | `docs/permissions.md`; `packages/permissions/src/permissions.ts` |
| F17 | `docs/public-api.md` (auth, scopes, rate limits, MCP) |
| F18 | `packages/domain/src/plan-entitlements.ts`; `packages/domain/src/entitlement/policies.ts` |
| F19 | `docs/public-api.md` §Plans |
| F20 | `apps/web/src/dashboard/features/integrations/components/integration-card.tsx` |
| F21 | `CONTEXT.md` (Inbox Event); `integrations/webhook/src/webhook-provider-registration.ts` (`inboundHandlers: []`) |
| F22 | `README.md`; `LICENSE` |
| F23 | `packages/sdk/README.md`, `packages/sdk/package.json` |
| F24 | `apps/web/src/routes/_dashboard/$organizationId/settings/webhooks/index.tsx` (settings route) |
| F25 | `integrations/webhook/src/webhook-rpc-handlers.ts` |
| F26 | `integrations/webhook/src/webhook-manifest.ts` |
| F27 | `integrations/webhook/src/webhook-manifest.ts` — "Browser-safe connection form data. The endpoint is encrypted before persistence." |
| F28 | `integrations/webhook/src/webhook-management-live.ts` — `encryptWebhookCredentialMaterial`, writes `credentials_ciphertext` |
| F29 | `packages/domain-contracts/src/post-status-type.ts` (`PostStatusType` literals) |

### Canny (first-party, accessed 2026-10-05)

| Ref | Page |
| --- | --- |
| C1 | https://developers.canny.io/api-reference — webhook section `#webhooks`, `#event_types`, `#webhook_signature`; auth and rate limits at the top of the page |
| C2 | https://help.canny.io/en/articles/4195400-the-canny-api (written 2024-05-07) |
| C3 | https://canny.io/pricing (comparison matrix row "API & webhooks"; footer "© 2026 Canny") |
| C4 | https://help.canny.io/en/articles/3847317-admin-roles (permission matrix row "Manage webhooks") |
| C5 | https://help.canny.io/en/articles/1627383-zapier-integration (written 2025-11-10) |
| C6 | https://help.canny.io/en/articles/15878435-getting-feedback-into-canny-from-tools-without-a-native-integration (written 2026-07-08) |
| C7 | https://canny.io/ (site structure) |
| C8 | https://developers.canny.io/install (JavaScript SDK / Identify); https://help.canny.io/en/articles/13063190-canny-mcp-server (MCP plan gate) |
| C9 | https://help.canny.io/en/articles/9131812-canny-s-billing-plans; https://help.canny.io/en/articles/10479191-does-canny-have-an-open-api |

### Specification

| Ref | Source |
| --- | --- |
| SWH | https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md — the scheme `docs/webhooks.md` names ("Standard Webhooks headers") and the `standardwebhooks` package implements |
