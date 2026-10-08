# ADR 0012: Integration events cover the post lifecycle

## Decision

Integration event types are named `<object>.<past-tense verb>` — `post.created`, `post.status_changed` — with no product or aggregate prefix. The object is the stable part of the name and the verb says what happened to it; a prefix encodes a grouping no consumer subscribes by and every reader has to learn. `webhook.test` is the one exception: it runs the real delivery path, is deliberately not subscribable, and is named for the machinery rather than an object.

The catalogue is the post's externally visible lifecycle, not only its creation:

| Event                 | State   |
| --------------------- | ------- |
| `post.created`        | shipped |
| `post.status_changed` | shipped |
| `post.edited`         | planned |
| `post.deleted`        | planned |
| `post.tag_added`      | planned |
| `post.tag_removed`    | planned |
| `comment.created`     | planned |
| `comment.edited`      | planned |
| `comment.deleted`     | planned |
| `vote.created`        | planned |
| `vote.deleted`        | planned |

Every kind recorded in `PostActivityKind` that a member or an end user can observe is a candidate; the planned entries are the ones the activity vocabulary already has. Merge and unmerge, archive and unarchive, lock and unlock, pin and unpin, author change, and official-update facts are recorded too and may be added later under the same rule — the table is the committed set, not the ceiling.

Explicitly out of scope: Jira issue link and unlink events. Feeblo has no Jira provider; its external-issue link is the GitHub one, and that link arrives as an inbound webhook feeding an organization-owned sync rule (ADR 0001), not as an outbound fact the workspace publishes.

Naming note: `post.status_changed` also names an `email_outbox.kind` (`packages/domain-contracts/src/email.ts`). The two are separate vocabularies on separate tables and no code compares them; the overlap is a search hazard, preferred to inventing a third spelling for the same fact.

## Why

A webhook consumer exists to keep a system in sync with a workspace's feedback, and mirroring is only correct if every externally visible change arrives. Creation and status changes alone make a mirror wrong the moment someone edits a title, adds a tag, comments, or votes, and the consumer cannot tell that it is wrong — it has to poll the Public API to find out, which is the thing events exist to avoid.

None of these events needs new state. Each one is already written as an immutable `post_activity` row inside the same transaction as the mutation (ADR 0001), and the activity vocabulary was built for exactly this history: what changed, from what, to what, by whom. The work is projection, not capture — one literal, one data struct, one record call, one payload variant, and the recorder that fans out transactionally already exists.

The naming rule follows the same reasoning. An integration event is about a post or a comment; that is what a consumer switches on. Past-tense verbs keep the pair consistent — `created` happened, `status_changed` happened — and leave room for a fact that is announced before it is true.

## Consequences

`objectType` widens beyond `post` when the first comment or vote event ships. The payload shape (ADR 0011) already accommodates it: `object` is the subject and `post`/`board` are context, so a comment event carries its comment as `object` and its post beside it.

Before the first new event ships, each provider capability must declare the event types it can render in its manifest, and route creation must validate the selection against it. Today nothing ties the two: the Slack, Discord, and GitHub handlers decode post event data, so a route that subscribed to a comment event would fail permanently at delivery time.

Comment and vote events are higher volume than post events, and vote volume is unbounded per post. Routes already select per event type, so a receiver opts in; this decision introduces no coalescing and changes no retry or delivery behaviour.

The Public API already publishes the same history through `listPostActivity`, which is what makes this catalogue a projection of an existing surface rather than a new source of truth.
