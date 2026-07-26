# In-app notifications

Feeblo’s in-app notifications are durable, per-member inbox records. PostgreSQL is the source of truth; the dashboard polls it through authenticated RPCs. Notifications are not delivered through webhooks or WebSockets.

## Triggering flow

```text
Authorized post/comment mutation
        │
        ├─ writes the source record and subscriptions in one DB transaction
        ├─ resolves recipients and inserts notification rows in that transaction
        └─ commits
              │
              └─ dashboard polls unread count and inbox every 30 seconds
```

The existing submission-email workflow is independent. An in-app row is committed before the asynchronous email workflow is scheduled, so an unavailable scheduler cannot lose an inbox notification.

| Event type | Trigger | Notified members | Excluded |
| --- | --- | --- | --- |
| `feedback.submitted` | A feedback post is created from the dashboard or public board | Workspace owners and admins | The post creator, if they are also an owner/admin |
| `feedback.commented` | A comment is created on a post | The post creator and all post subscribers | The commenter; duplicate recipients are reduced to one notification |
| `feedback.status_changed` | A post’s status is changed | The post creator and all post subscribers | The member who changed the status; duplicate recipients are reduced to one notification |

These are the only valid stored notification event types. They are enforced by the PostgreSQL `notification_kind` enum, the domain `NotificationEventType` schema, and the service input type. Adding an event requires updating all three deliberately.

Recipient lists are deduplicated and the actor member is excluded. Consequently, a sole workspace owner who creates a dashboard post will not see a notification for their own action. Mention notifications are not yet implemented because Feeblo does not currently have a canonical member-mention syntax or UI.

Each stored notification contains the rendered title/body and dashboard `href`, rather than requiring the UI to reconstruct old event content from mutable post data. Submission and comment events use deterministic deduplication keys, so retried creation does not produce another inbox item for the same recipient.

## Permissions and data isolation

Notification RPCs are authenticated and protected by `NotificationPolicy.canAccess(organizationId)`, which requires current membership in that workspace.

The client never supplies a recipient ID. The handler derives the current membership from the authenticated session and scopes every read/write with both:

- `organizationId`
- `recipientMemberId`

This applies to `NotificationList`, `NotificationUnreadCount`, `NotificationMarkRead`, and `NotificationMarkAllRead`. A member therefore cannot list, count, or mark another member’s notifications—even if they know a notification ID. The handler tests cover membership denial and cross-member mark-read isolation.

## Dashboard behavior

`NotificationsMenu` polls the unread count every 30 seconds and polls the list only while the menu is open. Selecting a notification immediately navigates through TanStack Router, passes an optional URL hash separately for comment deep links, and marks the item read in the background. A mark-read failure never blocks navigation.

## Extending the system

Add new event types through `NotificationService` and call them inside the source mutation’s existing database transaction. Add recipient-resolution tests alongside the handler tests. Do not add an external webhook transport for dashboard delivery; if Feeblo later exposes webhooks to customers, introduce a transactional outbox and retrying signed dispatcher as a separate integration boundary.
