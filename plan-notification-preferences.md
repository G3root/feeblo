# Notification Preferences (Email) Plan

> **Status:** Design agreed through a grilling round on 2026-10-09. Implementation proceeds in slices; this document records the settled decisions so the code and the review share one contract. The app is **not deployed**, so deletions are hard deletions and the preference table needs no data backfill.

## Objective

One per-member, per-workspace email preference surface: **Settings → Notifications** (Personal group), with two tabs — **Feedback** and **Changelog**. In-app preferences and digest frequency are later phases.

There are exactly **three** product emails after this work:

1. **New feedback** — every new post creation, to all members unless opted out, regardless of role.
2. **Post status change** — status change, merge, unmerge, and close, to all members unless opted out, plus verified double-opt-in subscribers of the post.
3. **Changelog published** — to all members unless opted out, plus verified changelog subscribers.

## Settled decisions

| Decision | Choice |
| --- | --- |
| Preference storage | New sparse `notification_preference` table keyed `(organization_id, user_id, channel, category)`; no row = enabled; `channel` ships now with `email` only |
| Default | Members: all three default **on**. End users: opt-in only, double-opt-in email consent unchanged |
| Scope | Per `(workspace, user)`; no admin override, no organization-wide toggle |
| Page | Moved to the Personal sidebar group; membership-gated only; URL `/$organizationId/settings/notifications` kept |
| Tabs | Feedback = New feedback + Post status changes; Changelog = Changelog published |
| Master pause | One "Pause all notification emails" switch above the tabs; suppresses every delivery in the three categories to that address in that workspace, independent of why the recipient was selected; consent rows are not touched |
| Actor | The member who performed the action is never emailed about it |
| Dedupe | At most one delivery per address per event; when a member is also a verified subscriber the subscriber variant wins (tokenized one-click unsubscribe) |
| Links | PUBLIC board ⇒ public site URL; PRIVATE board ⇒ dashboard URL; new feedback ⇒ dashboard; changelog ⇒ public site |
| Unverified members | No notification email until the account email is verified; the page shows a notice |
| Plan gating | Member notifications are entitlement-free on every plan; end-user subscriber emails keep the `subscriberEmails` capability. `submissionNotificationRecipients` is deleted from the catalog |
| Windows | Existing coalescing stays: submissions 5 min burst / 1 h ceiling; status 5 min; closures merges/unmerges immediate |
| One-click unsubscribe | RFC 8058 for member emails too; the click turns off that category, not the master pause |
| In-app | Frozen as-is this phase |

## Deletions (no deployment, no decode-compat release)

- Email intents `changelog.update_requested` and `post.official_update_published`, their enqueue sites, content branches, and templates.
- `ChangelogSendUpdate` RPC/handler/schema (no UI caller; it only sent the removed email).
- `submission` email-subscription topic and the old `EmailSubmissionNotificationPreferenceGet/Set` RPCs, handlers, repository helpers, and dashboard component.
- `submissionNotificationRecipients` limit and its `submissionNotificationRecipientLimit` entitlement accessor.

`subscription.verification_requested`, auth email, and the underlying changelog "send update" and official-update product features are untouched beyond losing their email.

## Deferred (kept in mind, no code now)

- **"Don't notify" checkbox** on the status-change surfaces, suppressing email and in-app for that single change, ignoring the coalescing window. Both the composer and the post editor were the chosen surfaces.
- **In-app channel** — the `channel` column and RPC target model are built for it.
- **Digest frequency** — immediate/daily/weekly; the unused `weekly-digest` template is the seed.

## Recipient resolution (delivery phase)

For each of the three intents:

1. Resolve the natural audience (members default-on for all three; verified `email_subscription` rows for post/changelog events).
2. Drop the actor.
3. Drop members whose category row is disabled, and every delivery to an address whose user has the master pause row disabled.
4. Drop members without a verified account email.
5. Dedupe by lowercased address; a verified subscription for the event's topic wins and carries the tokenized unsubscribe target.

## Implementation slices

1. **Foundation** — ✅ table + migration, `@feeblo/id` factory, domain-contracts vocabulary, `packages/domain/src/notification-preference/` module (schema, repository, rpcs, handlers), RPC registration, module tests.
2. **Delivery** — ✅ recipient resolution and pause/dedupe in the outbox, content (actor, links, audience-aware footers), intent deletions, entitlement gate split. `mayMaterializeEmailIntent` is gone: member notifications are entitlement-free and `mayEmailSubscribers` gates only the subscriber audience at materialization. One open interpretation: a coalesced submission window drops a member only when every post in it is theirs, so mixed-author windows still reach each author about the others' posts. The `submissionNotificationRecipients` catalog entry and the old submission consent path survive until slice 3 because the legacy preference handler still reads the limit.
3. **Surfaces** — ✅ stateless preference unsubscribe token + `/api/notification-preferences/unsubscribe` (GET link and RFC 8058 POST), member deliveries carry a `preference` unsubscribe target (body link to settings, one-click headers), the Settings → Notifications page with Feedback/Changelog tabs and the master pause, the Personal sidebar move, and the old-path deletion (the `submission` email-subscription topic, the legacy preference RPCs/handlers/repository helpers/dashboard component, and the `submissionNotificationRecipients` limit across plan entitlements, pricing, and telemetry).
