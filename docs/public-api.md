# Public API (v1)

The Public API lets a workspace read and manage its own Feeblo data programmatically. It is versioned, authenticated with an API key, and available on paid plans.

It is **not** the public portal — the feedback board and widget that anyone can read — and **not** the dashboard transport, which is session-authenticated.

- **Base URL:** `{API_URL}/api/v1`
- **Content type:** `application/json`
- **OpenAPI:** `GET {API_URL}/api/v1/openapi.json`

## Authentication

Every request carries an API key:

```http
GET /api/v1/boards/brd_example/posts HTTP/1.1
x-api-key: fbk_...
```

Keys are **organization-owned machine credentials**. A key reads only the workspace that owns it; no request parameter can change that, and there is no way to reach another workspace's data. Keys are stored hashed — the plaintext value is shown once, when the key is created, and cannot be retrieved again.

| Failure | Status | Code |
| --- | --- | --- |
| No `x-api-key` header | 401 | `MISSING_API_KEY` |
| Unknown, revoked, expired, or disabled key | 401 | `INVALID_API_KEY` |
| Key lacks the scope the endpoint requires | 403 | `FORBIDDEN_SCOPE` |
| Workspace plan does not include the Public API | 403 | `PLAN_REQUIRES_UPGRADE` |

## Scopes

| Scope | Grants |
| --- | --- |
| `posts.read` | Read posts, their status, tags, and vote and comment counts. Required by both post endpoints. |
| `comments.read` | Read a post's comments through `/posts/{postId}/comments`, internal notes included. Every key receives it. |
| `comments.create` | Comment on a post. The comment is attributed to the customer the request names — an API key has no user of its own. |
| `comments.update` | Replace a comment's body, and its visibility when the request names one. |
| `comments.delete` | Delete a comment and every reply beneath it. |
| `comments.pin` | Pin a comment to the top of its post, or unpin it. A post has at most one pinned comment. |
| `tags.read` | Read the workspace's tags through the `/tags` endpoints. A post's embedded tags come with the post, under `posts.read`. |
| `tags.create` | Create a tag. |
| `tags.update` | Rename a tag. |
| `tags.delete` | Delete a tag, which removes it from every post that carried it. |
| `tags.assign` | Set which tags a post carries. |
| `changelog.read` | Read changelog entries, drafts and scheduled entries included, through the `/changelog` endpoints. Every key receives it. |
| `changelog.create` | Create a changelog entry. Omitting `status` creates a draft, and sending `published` additionally requires `changelog.publish`. |
| `changelog.update` | Replace a changelog entry's title, slug, body, cover image, status, and timestamps. |
| `changelog.delete` | Delete a changelog entry and its links to the posts it announced. |
| `changelog.publish` | Publish an entry: a create that starts published, or an update that moves one into `published`. Publishing emails everyone subscribed to the changelog. |
| `companies.read` | Read the workspace's companies through the `/companies` endpoints. |
| `companies.create` | Create a company. |
| `companies.update` | Update a company's name, external id, avatar, or external creation date. |
| `companies.delete` | Delete a company, which detaches it from the contacts that belonged to it. |
| `boards.read` | Reserved for a future board-metadata endpoint. No v1 endpoint requires it, and every key receives it so that endpoint is additive when it ships. |

A key is created with a fixed set of scopes and never gains one afterwards. Every key starts with the read scopes above except the `companies` ones; the `comments`, `tags`, and `changelog` write scopes, and all four `companies` scopes, are granted only when the key is created with them — so a key that was minted to read feedback cannot delete a workspace's comments or tags, broadcast a release note, or learn the customer roster. The CRM grant is opt-in as a whole, read included, because a company is a record about the workspace's own customers rather than the workspace's content. That is also why a key created before a scope existed keeps its narrower grant: rotate the key if an integration needs more than it was issued.

`comments.pin` is separate from `comments.update` for the same reason the dashboard keeps moderation apart from authorship: editing a comment's words and deciding which one sits at the top of a post are different authorities.

`changelog.publish` is separate from `changelog.update` because publishing is not reversible in the way an edit is: it emails every subscriber. A key that syncs drafts from a CMS can hold `changelog.create` and `changelog.update` and still be unable to broadcast.

`end_users.read` is reserved for a future release.

## Endpoints

### List a board's posts

```http
GET /api/v1/boards/{boardId}/posts
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |
| `status` | — | A status id. |
| `includeArchived` | `false` | Archived posts are excluded by default. |

```json
{
  "data": [
    {
      "id": "pst_example",
      "boardId": "brd_feedback",
      "title": "Dark mode",
      "slug": "dark-mode",
      "excerpt": "Please add a dark theme.",
      "url": "https://app.feeblo.com/org_example/post/feedback/dark-mode",
      "status": { "id": "pss_planned", "name": "Planned", "type": "PLANNED" },
      "etaQuarter": "2026-Q3",
      "tags": [{ "id": "tag_ui", "name": "UI" }],
      "voteCount": 12,
      "commentCount": 4,
      "author": {
        "type": "end_user",
        "displayName": "Jamie",
        "avatarUrl": null
      },
      "createdAt": "2026-08-11T00:00:00.000Z",
      "updatedAt": "2026-08-12T09:30:00.000Z",
      "lockedAt": null,
      "archivedAt": null,
      "mergedIntoPostId": null
    }
  ],
  "nextCursor": null
}
```

### Get a post

```http
GET /api/v1/posts/{postId}
```

Returns the same object plus `content`.

### List tags

```http
GET /api/v1/tags
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |

```json
{
  "data": [
    {
      "id": "tag_ui",
      "name": "UI",
      "slug": "ui",
      "createdAt": "2026-08-11T00:00:00.000Z",
      "updatedAt": "2026-08-12T09:30:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `tags.read`. Every tag in the workspace is returned, whether or not a post carries it, and tags used only on private boards are included — the key is the workspace's own credential, not a public visitor.

### Get a tag

```http
GET /api/v1/tags/{tagId}
```

Returns one tag in the shape above. Requires `tags.read`.

### Create a tag

```http
POST /api/v1/tags
Content-Type: application/json

{ "name": "UI" }
```

Responds `201` with the created tag. Requires `tags.create`.

The `id` is assigned by the server, and `slug` is derived from the name. The name is trimmed, so `"  UI  "` is stored as `"UI"`. A name already used in the workspace — or a name that produces the same slug, such as `UI` and `ui` — is answered with `409 CONFLICT` rather than creating a near-duplicate.

### Rename a tag

```http
PATCH /api/v1/tags/{tagId}
Content-Type: application/json

{ "name": "Interface" }
```

Responds `200` with the updated tag. Requires `tags.update`.

`name` is the only writable field and the `slug` is re-derived from it; the tag's `id` never changes, and neither does the set of posts that carry it. A name already used by another tag is answered with `409 CONFLICT`.

### Delete a tag

```http
DELETE /api/v1/tags/{tagId}
```

Responds `204` with no body. Requires `tags.delete`.

The tag is removed from every post that carried it. The posts themselves are not modified, and the deletion cannot be undone.

### Set a post's tags

```http
PUT /api/v1/posts/{postId}/tags
Content-Type: application/json

{ "tagIds": ["tag_ui", "tag_performance"] }
```

Responds `200` with the tags the post carries afterwards:

```json
{
  "data": [
    { "id": "tag_performance", "name": "Performance" },
    { "id": "tag_ui", "name": "UI" }
  ]
}
```

Requires `tags.assign`.

The list **replaces** the post's tags rather than adding to them, so a caller that knows the final set cannot leave a tag behind by forgetting to remove it. An empty list clears the post. Tags are ordered by name, so repeated reads of the same post return the same order, and the same array appears in the post's own `tags` field.

Every id must exist in the workspace: an unknown id — including one belonging to another workspace — is answered with `400 INVALID_REQUEST` and nothing is written, rather than silently tagging the post with whatever happened to exist. Sending the same id twice is one tag, not an error.

The change is recorded in the post's timeline as the tags that were added and removed. A key is not a member, so those entries have no actor and the dashboard shows them as "Someone".

### List a post's comments

```http
GET /api/v1/posts/{postId}/comments
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |

```json
{
  "data": [
    {
      "id": "cmt_example",
      "postId": "pst_example",
      "content": "Please add a dark theme.",
      "visibility": "PUBLIC",
      "parentCommentId": null,
      "pinnedAt": null,
      "author": {
        "type": "end_user",
        "displayName": "Jamie",
        "avatarUrl": null
      },
      "createdAt": "2026-08-11T00:00:00.000Z",
      "updatedAt": "2026-08-11T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `comments.read`. Comments are returned newest first, on the same cursor as every other list. A pinned comment carries a `pinnedAt` and appears in its created position rather than first: a second sort key would make this one endpoint page differently from the rest. Internal comments are included, because the key belongs to the workspace, and report `visibility: "INTERNAL"`. A post that does not exist in the workspace, or belongs to another one, is `404 NOT_FOUND`.

A comment belongs to the post it currently lives on. When a post is merged into another, its comments move to the survivor, so ask the survivor for them; the source reports none of its own.

### Get a comment

```http
GET /api/v1/comments/{commentId}
```

Returns one comment in the shape above. Requires `comments.read`.

### Create a comment

```http
POST /api/v1/posts/{postId}/comments
Content-Type: application/json

{
  "content": "+1, our team needs this.",
  "author": { "email": "jamie@example.com", "name": "Jamie" }
}
```

Responds `201` with the comment it created. Requires `comments.create`.

`author` is required and names the customer the comment is attributed to. An API key is a machine credential with no user of its own, so it cannot "be" the author: the request states whose name the comment carries. Identifiers are consulted in strict priority order — `userId`, then `contactId`, then `externalId`, then `email` — and `name` and `avatarUrl` only enrich the resolved contact; an email that matches no contact creates one. A subject that resolves to no account at all is `400 INVALID_REQUEST`.

`content` is sanitized exactly as the dashboard sanitizes a comment. A body that is empty — or that sanitizes to nothing, such as one made only of whitespace — is refused rather than stored as a comment that renders as nothing. `visibility` optionally sets `PUBLIC` (the default) or `INTERNAL`; an internal comment is a workspace note and is not shown on the public board. `parentCommentId` optionally makes the comment a reply, and must name a comment on the same post and workspace — anything else, including another workspace's comment, is `400 INVALID_REQUEST`.

A post whose conversation is locked refuses the create with `409 CONFLICT`: a lock is a state a member set deliberately, and a machine key is not an exception to it. A post that was merged into another refuses it the same way, because it redirects to its survivor and is read-only until it is unmerged. The comment is recorded in the post's timeline with no actor, the same way an API tag change is.

### Update a comment

```http
PATCH /api/v1/comments/{commentId}
Content-Type: application/json

{ "content": "Closing this out.", "visibility": "PUBLIC" }
```

Responds `200` with the comment afterwards. Requires `comments.update`.

`content` is required and replaces the body; `visibility` is optional, and omitting it leaves the stored visibility alone. The body is sanitized exactly as on a create, a body that is empty or sanitizes to nothing is refused, and the edit is recorded in the post's timeline. Widening a reply to `PUBLIC` is refused while its parent is `INTERNAL`, the same rule a create enforces, so an edit is not a way around it; an edit that carries the visibility the comment already has is not a widening, so it is never refused for that reason and the body stays editable.

### Delete a comment

```http
DELETE /api/v1/comments/{commentId}
```

Responds `204` with no body. Requires `comments.delete`. Every reply beneath the comment is deleted with it, because replies do not outlive their parent. A comment that is already gone is `404 NOT_FOUND` rather than a success.

### Pin a comment

```http
POST /api/v1/comments/{commentId}/pin
```

Responds `200` with the comment and its `pinnedAt`. Requires `comments.pin`. A post has at most one pinned comment, so pinning one releases whatever was pinned before it. Pinning a comment that is already pinned is answered the same way; the change is recorded in the post's timeline either way.

### Unpin a comment

```http
POST /api/v1/comments/{commentId}/unpin
```

Responds `200` with the comment and a `null` `pinnedAt`. Requires `comments.pin`. Unpinning a comment that is not pinned changes nothing and is answered with the comment as it stands, so a retried request does not fail merely because the pin was already released; a comment that has been deleted is still the documented `404 NOT_FOUND`.

### List changelog entries

```http
GET /api/v1/changelog
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |
| `status` | — | `draft`, `scheduled`, or `published`. |

```json
{
  "data": [
    {
      "id": "chg_dark_mode",
      "title": "Dark mode shipped",
      "slug": "dark-mode-shipped",
      "excerpt": "Dark mode is live for every workspace.",
      "coverImage": null,
      "status": "published",
      "scheduledAt": null,
      "publishedAt": "2026-09-01T00:00:00.000Z",
      "createdAt": "2026-08-30T10:00:00.000Z",
      "updatedAt": "2026-09-01T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `changelog.read`. Entries of every status are returned, newest first — the key is the workspace's own credential, so an integration that syncs release notes sees what has not shipped yet. Pass `status=published` to list only what readers can already see.

### Get a changelog entry

```http
GET /api/v1/changelog/{changelogId}
```

Returns the same object plus `content`, the entry's stored, sanitized Markdown. Requires `changelog.read`. Entries of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace.

### Create a changelog entry

```http
POST /api/v1/changelog
Content-Type: application/json

{
  "title": "Dark mode shipped",
  "content": "Dark mode is live. Enable it in **Settings**."
}
```

Responds `201` with the created entry. Requires `changelog.create`, and additionally `changelog.publish` when `status` is `published`.

The `id` is assigned by the server. The `slug` is derived from the title unless one is sent, and a sent slug is normalized the same way, so `UI Kit` and `ui-kit` are one entry rather than two. `excerpt` is derived from the body, and the body is sanitized before it is stored, exactly as the dashboard sanitizes it. A slug already used in the workspace is answered with `409 CONFLICT`.

| Field | Default | Notes |
| --- | --- | --- |
| `title` | — | Required. Trimmed; must not be empty. |
| `content` | — | Required. Markdown; sanitized before it is stored. |
| `slug` | derived from `title` | Normalized to a URL-safe form. |
| `coverImage` | `null` | An `http(s)` URL. |
| `status` | `draft` | `draft`, `scheduled`, or `published`. |
| `scheduledAt` | `null` | Required when `status` is `scheduled`. |
| `publishedAt` | `null` | Required when `status` is `published`. |

### Update a changelog entry

```http
PATCH /api/v1/changelog/{changelogId}
Content-Type: application/json

{
  "title": "Dark mode shipped",
  "content": "Dark mode is live for everyone.",
  "status": "published",
  "publishedAt": "2026-09-01T00:00:00.000Z"
}
```

Responds `200` with the updated entry. Requires `changelog.update`.

The fields sent are the entry's new state — the update replaces them rather than merging. `status` is required here, unlike on a create: an update that left it out would move an entry by omission. The same field rules as a create apply to `title`, `slug`, `content`, `coverImage`, `scheduledAt`, and `publishedAt`.

Moving an entry **into** `published` — from `draft` or `scheduled` — also requires `changelog.publish`, and records the publication email intent. Editing an entry that is already published does not: it is an ordinary edit, and subscribers are not emailed again. Use the dashboard's "Send update" action when an edit should be announced.

### Delete a changelog entry

```http
DELETE /api/v1/changelog/{changelogId}
```

Responds `204` with no body. Requires `changelog.delete`.

The entry's links to the posts it announced are removed with it. The posts themselves are not modified, and the deletion cannot be undone.

### List companies

```http
GET /api/v1/companies
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |

```json
{
  "data": [
    {
      "id": "cmp_acme",
      "name": "Acme",
      "externalId": "crm-4711",
      "avatar": "https://cdn.example.com/acme.png",
      "externalCreatedAt": "2026-01-02T00:00:00.000Z",
      "source": "API",
      "createdAt": "2026-08-11T00:00:00.000Z",
      "updatedAt": "2026-08-12T09:30:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `companies.read`. Every company in the workspace is returned, whatever `source` it has, so a caller that syncs its CRM can also see the records the dashboard and the widget created.

A company is an **account record and nothing more**. The contacts who belong to it are not returned, and neither are the workspace's custom attribute values; see [Data exposure](#data-exposure).

### Get a company

```http
GET /api/v1/companies/{companyId}
```

Returns one company in the shape above. Requires `companies.read`.

### Create a company

```http
POST /api/v1/companies
Content-Type: application/json

{ "name": "Acme", "externalId": "crm-4711" }
```

Responds `201` with the created company. Requires `companies.create`.

The `id` is assigned by the server. `externalId` is your own identifier for the company — the one to send, rather than trying to make the primary key agree with a system this workspace does not control. It is unique within the workspace, and `null` may be left unset on any number of companies. `externalCreatedAt` records when the company was created in your system; the API's own `createdAt` is kept beside it.

The name is trimmed, so `"  Acme  "` is stored as `"Acme"`. A name, or an `externalId`, already used in the workspace is answered with `409 CONFLICT` rather than creating a second record for the same account. A company created here carries `source: "API"`.

A create is also refused with `403 PLAN_REQUIRES_UPGRADE` when the workspace's plan has no room for another CRM entry. Companies and contacts count together towards that limit, exactly as they do in the dashboard, so the API is never a way around a plan's own cap. The count is taken inside the same transaction that writes the company, against a lock on the workspace, so two such creates arriving at the cap together cannot both fit.

### Update a company

```http
PATCH /api/v1/companies/{companyId}
Content-Type: application/json

{ "name": "Acme Corporation", "avatar": null }
```

Responds `200` with the company afterwards. Requires `companies.update`.

An omitted field is left as it is; an explicit `null` clears a nullable one, so `"avatar": null` removes the avatar and the example above renames the company in the same request. A body that names no field at all is answered with `400 INVALID_REQUEST` rather than as a write that changed nothing. `id`, `source`, and the timestamps are not writable. A name or `externalId` another company already holds is answered with `409 CONFLICT`, and a company deleted while the request was in flight is answered with `404 NOT_FOUND` — never with a server error.

### Delete a company

```http
DELETE /api/v1/companies/{companyId}
```

Responds `204` with no body. Requires `companies.delete`.

The company's contacts are **not** deleted: they keep their own records and simply stop naming a company, exactly as when a company is deleted in the dashboard. The company's custom attribute values are removed with it, and the deletion cannot be undone.

## Pagination

Pagination is cursor-based. A response carries `nextCursor`; `null` means the last page. Cursors are opaque — do not construct or parse them — and are invalidated by the API without notice if they are malformed, in which case the API returns `400 INVALID_REQUEST`. Do not poll with offsets: posts, comments, tags, changelog entries, and companies are inserted continuously and offset paging skips and repeats rows.

## Errors

Every error uses one envelope, where `_tag` is the machine-readable code and `message` is for humans:

```json
{
  "_tag": "FORBIDDEN_SCOPE",
  "message": "This API key is missing the posts.read scope."
}
```

| Status | `_tag` | Meaning |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Malformed parameter, cursor, or limit; a body the endpoint cannot decode; a comment body that is empty or sanitizes to nothing; a name that is only whitespace; an update that names no field; a reply whose parent is not a comment on the same post; a reply widened to public beneath an internal parent; an author subject that resolves to no account. |
| 401 | `MISSING_API_KEY` | No `x-api-key` header was sent. |
| 401 | `INVALID_API_KEY` | The key is unknown, revoked, expired, or disabled. |
| 403 | `FORBIDDEN_SCOPE` | The key lacks the scope the endpoint requires. |
| 403 | `PLAN_REQUIRES_UPGRADE` | The workspace plan does not include the Public API, or has no room left in a limit it sets — such as CRM entries. |
| 404 | `NOT_FOUND` | The resource does not exist in this workspace. |
| 409 | `CONFLICT` | A write collided with something that already exists, such as a tag name or a company name or external id already in use, or comments on a post whose conversation is locked. |
| 429 | `RATE_LIMITED` | Per-key rate limit exceeded. Carries `Retry-After` in seconds. |
| 500 | `INTERNAL_ERROR` | Unexpected server failure. |
| 503 | `SERVICE_UNAVAILABLE` | A required dependency is unavailable; requests fail closed. |

Switch on `_tag`. Codes are append-only within v1 — a new one may appear, an existing one never changes meaning — and `message` is for humans and may change at any time. Each code appears as its own response, with the status above, in the OpenAPI document.

## Rate limits

Limits are per key, not per IP, and are shared across server instances: **300 requests per minute**, shared by reads and writes. Limits may increase without notice; decreases are announced in advance.

The per-key bucket means a customer behind a shared NAT is not throttled by their neighbours, and a leaked key cannot escape its limit by rotating source IPs. When the limit is exceeded the API returns `429 RATE_LIMITED` with `Retry-After`. If the rate limiter itself is unavailable, requests fail closed with `503 SERVICE_UNAVAILABLE` rather than being admitted unlimited.

## Plans

The Public API is included in **Starter** and **Professional**. A workspace on the Free plan cannot create keys, and requests made with keys from a workspace that has downgraded return `403 PLAN_REQUIRES_UPGRADE`.

On downgrade, keys are **kept and not disabled**. They start working again when the workspace upgrades, with no rotation and no reconfiguration in your integrations. Existing keys stay listed and can still be revoked while the workspace is on Free — only creating new ones is blocked.

## Data exposure

The Public API never returns:

- end-user email addresses, phone numbers, or contact records;
- internal actor identifiers — `usr_*`, `mem_*`, `cnt_*`;
- IP addresses, credentials, webhook secrets, or API keys.

`author` is always `{ type, displayName, avatarUrl }`: `type` is `member` or `end_user` and distinguishes workspace staff from end users. Display names are included because the workspace already sees them on public boards and the dashboard; they are the workspace's own data. Emails are deliberately excluded — a key travels into third-party infrastructure (an integration platform, a partner's backend, a CI log), and that is a different blast radius from a signed-in session.

Changelog entries carry no author at all: the dashboard's entry rows hold `creatorId` and `creatorMemberId`, and neither has a field in this API. Publishing through the API records the email intent and the in-app notification with no actor, exactly as a key's tag changes have no actor in a post's timeline.

Post `content` is sanitized before it is stored, so the body the API returns is the same sanitized content the dashboard and the public portal render. Tags carry a name and a slug, nothing else — a tag's creator is an internal identifier and is never returned.

Comments follow the same rule. A comment payload carries its author as `{ type, displayName, avatarUrl }`, never the `userId` or `memberId` the dashboard's comment rows hold, and its `content` is the sanitized body the dashboard and portal render. A comment's merge and status-transition provenance (`mergedFromPostId`, `statusUpdateId`) is not part of the resource either: it describes internal bookkeeping, not the comment a caller reads. A comment created with a key is attributed to the resolved customer, so nothing in the payload points back at the key that wrote it.

A company carries its name, avatar, your `externalId`, and `source`. Its contacts are not exposed and neither are the custom attribute values a workspace may have defined for companies: those definitions are a workspace-specific vocabulary, so they would need their own contract rather than a field on this one. The workspace is never named in a payload either — a key reads exactly one workspace, so an `organizationId` would be the same string on every response and would invite a filter parameter that would then have to be validated against the key. `source` is the exception that proves the rule: it is bookkeeping about where the row came from, not about who it belongs to, and it is what lets a sync tell its own records from the dashboard's.

## Which posts are visible

A key reads every board in its workspace, **including private boards**. The key is the workspace's own credential, not a public visitor, so the visibility rules that gate the public portal do not apply to it. If you need an integration limited to public boards, use a key from a workspace-scoped integration instead, or filter by board on your side.

## Versioning

The version is the path prefix. Within `/api/v1`:

- fields are added, never removed or repurposed;
- new **request** parameters are optional, never required;
- error codes are append-only;
- serialized field types never change.

Anything that cannot respect those rules ships as `/api/v2`. When a v2 exists, v1 responses carry `Deprecation` and `Sunset` headers and the window is announced here before it starts.

## Managing keys

Keys are managed in the dashboard under **Settings → Developers**, restricted to workspace admins and owners. The list shows a key's name and its first characters — `fbk_ab…` — which is enough to identify a key without exposing it. The plaintext value is displayed once, at creation. Revocation takes effect immediately and is not reversible.

When a key is created you choose its access: **Read only**, or any combination of **Manage comments**, **Manage tags**, **Manage changelog**, and **Manage companies**. The read scopes every key receives are fixed; the write scopes are granted only by the capability you select, and the choice fixes the key's scopes for its whole life, so pick the narrowest one the integration needs. Publishing is part of the changelog capability because it emails subscribers, so a key that only syncs drafts is not granted it.

Use one key per integration so that revoking one does not interrupt the others.
