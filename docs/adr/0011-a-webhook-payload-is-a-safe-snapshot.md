# ADR 0011: A webhook payload is a safe post snapshot, not a row

## Decision

Every external custom-webhook delivery is one versioned event shaped as an envelope plus a subject:

- Envelope: `id` (the event id), `organizationId`, `type`, `version`, `occurredAt`.
- `objectType` names the subject and `object` is its snapshot. For post events `object` carries `id`, `title`, `content` (sanitized markdown), `url`, `status` (`{ id, name, type }`), `author`, and optional `metadata`.
- `board` and `actor` are context: the board the post is on, and the person who caused the event. They are not the same person on a status change.
- `changes.status` carries `from` and `to` on `post.status_changed`; `object.status` is already `to`.

The payload is rendered from `integration_event.payload`, the snapshot recorded in the same transaction as the mutation — never by reading the post row at delivery time. The recorder (`packages/domain/src/integration/post-event-recording.ts`) therefore reads the post body, the author classification, and the status label when the event is recorded. `board.url` replaces `board.slug`, because a consumer links to a board rather than routing to it.

Identity is minimised by construction. A member is `{ type: "member", displayName }` — `mem_*` is never published (ADR 0010). An end user is `{ type: "end_user", id: cnt_*, externalId? }`, where `externalId` is the key the workspace set. Email, phone, and account identifiers never appear. The classification is the Public API's: `post.creatorMemberId` present means staff, absent means an outside end user.

`version` stays `1`. The product is not deployed, so this shape is the launch contract rather than a v2 over a shipped v1; from here, field additions are additive and only a breaking change would bump it.

## Event type names

Event types are `post.created` and `post.status_changed`, without a `feedback.` prefix. They match the names Canny publishes, so a consumer migrating between the two translates nothing, and the prefix carried no information — the event is about a post, and every provider, route and domain module already calls the object a post.

`post.status_changed` already names an `email_outbox.kind` value. The two are separate vocabularies on separate tables and no code compares them, so the overlap is a search hazard rather than a coupling; it was preferred to inventing a third spelling for the same fact.

## Why

A webhook receiver is the product's thinnest consumer and was the one given the least: it received `{ id, title, url }` while Slack, Discord, and GitHub already received the recorded `description` and `metadata` from the same event. Canny, the product this surface is compared against, sends the whole resource — body, author, counts — so a migrating consumer found Feeblo's webhook strictly poorer for no stated reason. The fix is to expose what the kernel already records instead of recording anything new.

Delivery timing forces the snapshot rule. A delivery is attempted up to seven times across roughly a day, so a payload that joined the post row at delivery time would describe whatever the row said when the attempt happened, not when the event happened, and two attempts of the same delivery could disagree. Reading author and body at record time is also cheaper than resolving them on every retry.

The minimization rules are structural rather than promises. The wire schema has no field for an email or a `usr_*`/`mem_*` id, and the recorder never puts one into the event data, so a future change cannot widen the payload by accident. Publishing `cnt_*` as the end-user join key follows ADR 0010: it addresses a customer, it is workspace-scoped, and an integration cannot attribute anything back to its own records without it.

## Consequences

`IntegrationPostEventData` gained required fields (`post.author`, `post.status.name`, `board.url`, `post.description`), so an event recorded before this decision would not decode. Nothing has been deployed, so no stored event predates it; if that changes, the envelope's `version` is where a migration would be expressed.

`content` is now sent on status changes too, where the recorded description was previously omitted. The cost is the post body duplicated in the event snapshot for each status change, bounded by `POST_CONTENT_MAX_LENGTH` (20 000 characters) against the transport's 256 KiB cap.

Adding a `comment` or `vote` event is now additive: `objectType` widens and each provider's capability manifest will need to declare which events it can render, so a Slack route cannot subscribe to an event its handler cannot decode. That declaration is future work and is not required by this decision.
