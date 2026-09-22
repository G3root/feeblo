# Public API (v1)

The Public API lets a workspace read its own Feeblo data programmatically. It is versioned, authenticated with an API key, and available on paid plans.

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
| `posts.read` | Read posts, their status, tags, and vote and comment counts. Required by both v1 endpoints. |
| `boards.read` | Reserved for a future board-metadata endpoint. No v1 endpoint requires it, and every key receives it so that endpoint is additive when it ships. |

A key is created with a fixed set of scopes and never gains one afterwards. `end_users.read` is reserved for a future release.

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

## Pagination

Pagination is cursor-based. A response carries `nextCursor`; `null` means the last page. Cursors are opaque — do not construct or parse them — and are invalidated by the API without notice if they are malformed, in which case the API returns `400 INVALID_REQUEST`. Do not poll with offsets: posts are inserted continuously and offset paging skips and repeats rows.

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
| 429 | `RATE_LIMITED` | Per-key rate limit exceeded. Carries `Retry-After` in seconds. |
| 500 | `INTERNAL_ERROR` | Unexpected server failure. |
| 503 | `SERVICE_UNAVAILABLE` | A required dependency is unavailable; requests fail closed. |

Switch on `_tag`. Codes are append-only within v1 — a new one may appear, an existing one never changes meaning — and `message` is for humans and may change at any time. Each code appears as its own response, with the status above, in the OpenAPI document.

## Rate limits

Limits are per key, not per IP, and are shared across server instances: **300 requests per minute** for reads. Limits may increase without notice; decreases are announced in advance.

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

Post `content` is sanitized before it is stored, so the body the API returns is the same sanitized content the dashboard and the public portal render.

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

Use one key per integration so that revoking one does not interrupt the others.
