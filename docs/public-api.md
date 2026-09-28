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
| `tags.read` | Read the workspace's tags through the `/tags` endpoints. A post's embedded tags come with the post, under `posts.read`. |
| `tags.create` | Create a tag. |
| `tags.update` | Rename a tag. |
| `tags.delete` | Delete a tag, which removes it from every post that carried it. |
| `tags.assign` | Set which tags a post carries. |
| `changelog.read` | Read changelog entries, drafts and scheduled entries included, through the `/changelog` endpoints. Every key receives it. |
| `changelog.create` | Create a changelog entry. A create is a draft unless it also holds `changelog.publish`. |
| `changelog.update` | Replace a changelog entry's title, slug, body, cover image, status, and timestamps. |
| `changelog.delete` | Delete a changelog entry and its links to the posts it announced. |
| `changelog.publish` | Publish an entry: a create that starts published, or an update that moves one into `published`. Publishing emails everyone subscribed to the changelog. |
| `boards.read` | Reserved for a future board-metadata endpoint. No v1 endpoint requires it, and every key receives it so that endpoint is additive when it ships. |

A key is created with a fixed set of scopes and never gains one afterwards. Every key starts with the read scopes above; the `tags` and `changelog` write scopes are granted only when the key is created with them, so a key that was minted to read feedback cannot delete a workspace's tags or publish a release note. A key created before a scope existed does not gain it later — rotate the key if an integration needs more than it was issued.

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

## Pagination

Pagination is cursor-based. A response carries `nextCursor`; `null` means the last page. Cursors are opaque — do not construct or parse them — and are invalidated by the API without notice if they are malformed, in which case the API returns `400 INVALID_REQUEST`. Do not poll with offsets: posts and tags are inserted continuously and offset paging skips and repeats rows.

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
| 400 | `INVALID_REQUEST` | Malformed parameter, cursor, or limit. |
| 401 | `MISSING_API_KEY` | No `x-api-key` header was sent. |
| 401 | `INVALID_API_KEY` | The key is unknown, revoked, expired, or disabled. |
| 403 | `FORBIDDEN_SCOPE` | The key lacks the scope the endpoint requires. |
| 403 | `PLAN_REQUIRES_UPGRADE` | The workspace plan does not include the Public API. |
| 404 | `NOT_FOUND` | The resource does not exist in this workspace. |
| 409 | `CONFLICT` | A write collided with something that already exists, such as a tag name already in use. |
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

- end-user email addresses or contact records;
- internal actor identifiers — `usr_*`, `mem_*`, `cnt_*`;
- IP addresses, credentials, webhook secrets, or API keys.

`author` is always `{ type, displayName, avatarUrl }`: `type` is `member` or `end_user` and distinguishes workspace staff from end users. Display names are included because the workspace already sees them on public boards and the dashboard; they are the workspace's own data. Emails are deliberately excluded — a key travels into third-party infrastructure (an integration platform, a partner's backend, a CI log), and that is a different blast radius from a signed-in session.

Changelog entries carry no author at all: the dashboard's entry rows hold `creatorId` and `creatorMemberId`, and neither has a field in this API. Publishing through the API records the email intent and the in-app notification with no actor, exactly as a key's tag changes have no actor in a post's timeline.

Post `content` is sanitized before it is stored, so the body the API returns is the same sanitized content the dashboard and the public portal render. Tags carry a name and a slug, nothing else — a tag's creator is an internal identifier and is never returned.

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

When a key is created you choose its access: **Read only**, **Read and manage tags**, **Read and manage changelog**, or **Read and manage tags and changelog**. The choice fixes the key's scopes for its whole life, so pick the narrowest one the integration needs. Publishing is part of the changelog choice because it emails subscribers, so a key that only syncs drafts is not granted it.

Use one key per integration so that revoking one does not interrupt the others.
