# Custom webhooks (V1)

V1 emits `feedback.post.created` and `feedback.post.status_changed`. A dashboard test uses `webhook.test`; it follows the real delivery/signing path but cannot be selected by a route.

Each external payload is versioned and includes `id`, `organizationId`, `type`, `version`, and `occurredAt`. It contains the post ID/title/absolute URL/current status, board ID/name/slug, optional previous status, and an actor classification. It excludes post content, email addresses, credentials, and private organization data.

```json
{
  "id": "iev_example",
  "organizationId": "org_example",
  "type": "feedback.post.created",
  "version": 1,
  "occurredAt": "2026-08-11T00:00:00.000Z",
  "post": {
    "id": "pst_example",
    "title": "Example",
    "url": "https://app.feeblo.com/org_example/post/feedback/example"
  },
  "board": { "id": "brd_feedback", "name": "Feedback", "slug": "feedback" },
  "status": { "id": "pss_open", "type": "PENDING" },
  "actor": { "type": "end_user" }
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
