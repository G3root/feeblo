# Custom webhooks (V1)

V1 emits `feedback.post.created` and `feedback.post.status_changed`. A dashboard test uses `webhook.test`; it follows the real delivery/signing path but cannot be selected by a route.

Each delivery is one versioned event. The envelope carries `id` (the event id, stable across routes), `organizationId`, `type`, `version`, and `occurredAt`. `objectType` names the subject and `object` is its snapshot: a post's title, sanitized content, absolute URL, status, author, and metadata. `board` and `actor` sit beside it as context — the board the post belongs to and the person who caused the event, which are not the same person on a status change.

Every event is a snapshot taken when the event was recorded, so a retry up to 24 hours later delivers the values that were true at the time, not the row's current state. Consumers must ignore unknown fields and unknown event types: fields may be added within `version: 1`, and only a breaking change would bump the version.

Payloads never carry email addresses, credentials, account identifiers (`usr_*`, `mem_*`), or other private organization data. An end user is identified by the workspace-scoped contact id (`cnt_*`) and the `externalId` the workspace set; a member is a display name only.

```json
{
  "id": "iev_9f4c1e7a2b",
  "organizationId": "org_4k81mz",
  "type": "feedback.post.created",
  "version": 1,
  "occurredAt": "2026-08-11T00:00:00.000Z",
  "objectType": "post",
  "object": {
    "id": "pst_example",
    "title": "Example",
    "content": "We need to schedule the weekly report as CSV.",
    "url": "https://app.feeblo.com/org_4k81mz/post/feedback/example",
    "status": { "id": "pss_open", "name": "Open", "type": "PENDING" },
    "author": {
      "type": "end_user",
      "id": "cnt_3b8e10",
      "externalId": "user_8812"
    }
  },
  "board": {
    "id": "brd_feedback",
    "name": "Feedback",
    "url": "https://app.feeblo.com/org_4k81mz/board/feedback"
  },
  "actor": { "type": "end_user" }
}
```

A status change uses the same envelope and adds `changes`; `object.status` is already the next state, so the event needs no second fetch to see what moved:

```json
{
  "id": "iev_a17d30c9e5",
  "organizationId": "org_4k81mz",
  "type": "feedback.post.status_changed",
  "version": 1,
  "occurredAt": "2026-08-12T09:14:52.108Z",
  "objectType": "post",
  "object": {
    "id": "pst_example",
    "title": "Example",
    "content": "We need to schedule the weekly report as CSV.",
    "url": "https://app.feeblo.com/org_4k81mz/post/feedback/example",
    "status": { "id": "pss_planned", "name": "Planned", "type": "PLANNED" },
    "author": {
      "type": "end_user",
      "id": "cnt_3b8e10",
      "externalId": "user_8812"
    }
  },
  "board": {
    "id": "brd_feedback",
    "name": "Feedback",
    "url": "https://app.feeblo.com/org_4k81mz/board/feedback"
  },
  "actor": { "type": "member", "displayName": "Nafees" },
  "changes": {
    "status": {
      "from": { "id": "pss_open", "name": "Open", "type": "PENDING" },
      "to": { "id": "pss_planned", "name": "Planned", "type": "PLANNED" }
    }
  }
}
```

## Signing and verification

Requests use the Standard Webhooks headers `webhook-id`, `webhook-timestamp`, and `webhook-signature`, plus `x-feeblo-event` and `User-Agent: Feeblo-Webhooks/1`. `webhook-id` is the stable delivery ID; the timestamp and signature are regenerated for every attempt. Verify the exact raw request bytes before JSON parsing.

```ts
import { Webhook } from "standardwebhooks";

const webhook = new Webhook(process.env.FEEBLO_WEBHOOK_SECRET!);
const event = webhook.verify(rawBody, {
  "webhook-id": request.headers.get("webhook-id")!,
  "webhook-timestamp": request.headers.get("webhook-timestamp")!,
  "webhook-signature": request.headers.get("webhook-signature")!,
});
```

Rotate secrets through the dashboard. The new secret is returned once; for 24 hours Feeblo signs with both the new and previous key, so consumers should retain both during that grace period.

## Retries and endpoint policy

Delivery is at least once. Treat the stable `webhook-id` as an idempotency key and return any 2xx after successful processing. Transport failures, timeouts, 408, 409, 425, 429, and 5xx retry with bounded jitter approximately after 1 minute, 5 minutes, 30 minutes, 2 hours, 8 hours, and 24 hours; other 3xx/4xx are terminal. A valid `Retry-After` on 429 is honored up to 24 hours. Feeblo does not follow redirects.

Production endpoints must be HTTPS, with no credentials or fragments, and must resolve to public addresses. Localhost, private/reserved networks, and cloud-metadata destinations are rejected. DNS is revalidated and pinned for every delivery. A development-only private-network override exists solely for local receivers. Deployments should also deny private-network and cloud-metadata egress at the infrastructure layer. Configure receivers to accept only intended public traffic and validate signatures on every request.
