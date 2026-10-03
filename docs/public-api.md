# Public API (v1)

The Public API lets a workspace read and manage its own Feeblo data programmatically. It is versioned, authenticated with an API key, and available on paid plans.

It is **not** the public portal — the feedback board and widget that anyone can read — and **not** the dashboard transport, which is session-authenticated.

- **Base URL:** `{API_URL}/api/v1`
- **Content type:** `application/json`
- **OpenAPI:** `GET {API_URL}/api/v1/openapi.json`
- **Reference:** `{API_URL}/api/v1/docs` — a Scalar page rendered from the same document. It carries the API key security scheme, so the Authorize button stores the key and sends it as `x-api-key` in the Try-it requests.
- **MCP:** `POST {API_URL}/mcp` — the same operations as [Model Context Protocol (MCP)](#model-context-protocol-mcp) tools, for a client that speaks the protocol instead of HTTP.

## Authentication

Every request carries an API key:

```http
GET /api/v1/boards/brd_example/posts HTTP/1.1
x-api-key: fbk_...
```

Keys are **organization-owned machine credentials**. A key reads only the workspace that owns it; no request parameter can change that, and there is no way to reach another workspace's data. Keys are stored hashed — the plaintext value is shown once, when the key is created, and cannot be retrieved again.

| Failure | Status | Code |
| --- | --- | --- |
| No `x-api-key` header, or an empty one | 401 | `MISSING_API_KEY` |
| Unknown, revoked, expired, or disabled key | 401 | `INVALID_API_KEY` |
| Key lacks the scope the endpoint requires | 403 | `FORBIDDEN_SCOPE` |
| Workspace plan does not include the Public API | 403 | `PLAN_REQUIRES_UPGRADE` |

## Scopes

| Scope | Grants |
| --- | --- |
| `posts.read` | Read posts, their status, tags, and vote and comment counts. Required by every post read endpoint. |
| `posts.create` | Create a post on a board of the calling workspace. |
| `posts.update` | Update a post's title, body, status, board, or ETA quarter. |
| `posts.delete` | Delete a post. Deleting cannot be undone. |
| `comments.read` | Read a post's comments through `/posts/{postId}/comments`, internal notes included. Every key receives it. |
| `comments.create` | Comment on a post. The comment is attributed to the customer the request names — an API key has no user of its own. |
| `comments.update` | Replace a comment's body, and its visibility when the request names one. |
| `comments.delete` | Delete a comment and every reply beneath it. |
| `comments.pin` | Pin a comment to the top of its post, or unpin it. A post has at most one pinned comment. |
| `votes.read` | Read a post's votes through `/posts/{postId}/votes`. Every key receives it. |
| `votes.create` | Add a vote on a customer's behalf. The vote is attributed to the customer the request names. |
| `votes.delete` | Remove one vote from a post. The vote is named by its own id, never by the account behind it. |
| `tags.read` | Read the workspace's tags through the `/tags` endpoints. A post's embedded tags come with the post, under `posts.read`. |
| `tags.create` | Create a tag. |
| `tags.update` | Rename a tag. |
| `tags.delete` | Delete a tag, which removes it from every post that carried it. |
| `tags.assign` | Set which tags a post carries. The endpoint is documented under [Set a post's tags](#set-a-posts-tags), with the post resource, because it writes a post. |
| `changelog.read` | Read changelog entries, drafts and scheduled entries included, through the `/changelog` endpoints. Every key receives it. |
| `changelog.create` | Create a changelog entry. Omitting `status` creates a draft, and sending `published` additionally requires `changelog.publish`. |
| `changelog.update` | Replace a changelog entry's title, slug, body, cover image, status, and timestamps. |
| `changelog.delete` | Delete a changelog entry and its links to the posts it announced. |
| `changelog.publish` | Publish an entry: a create that starts published, or an update that moves one into `published`. Publishing emails everyone subscribed to the changelog. |
| `companies.read` | Read the workspace's companies through the `/companies` endpoints. |
| `companies.create` | Create a company. |
| `companies.update` | Update a company's name, external id, avatar, or external creation date. |
| `companies.delete` | Delete a company, which detaches it from the contacts that belonged to it. |
| `boards.read` | Read the workspace's boards through the `/boards` endpoints. Required by every board endpoint, and every key receives it. |

A key is created with a fixed set of scopes and never gains one afterwards. Every key starts with the read scopes above except the `companies` ones; the `posts`, `comments`, `votes`, `tags`, and `changelog` write scopes, and all four `companies` scopes, are granted only when the key is created with them — so a key that was minted to read feedback cannot delete a workspace's posts, comments, or tags, remove its votes, broadcast a release note, or learn the customer roster. The CRM grant is opt-in as a whole, read included, because a company is a record about the workspace's own customers rather than the workspace's content. That is also why a key created before a scope existed keeps its narrower grant: rotate the key if an integration needs more than it was issued.

`comments.pin` is separate from `comments.update` for the same reason the dashboard keeps moderation apart from authorship: editing a comment's words and deciding which one sits at the top of a post are different authorities.

`changelog.publish` is separate from `changelog.update` because publishing is not reversible in the way an edit is: it emails every subscriber. A key that syncs drafts from a CMS can hold `changelog.create` and `changelog.update` and still be unable to broadcast.

`end_users.read` is reserved for a future release.

## Model Context Protocol (MCP)

The same API is served as an MCP server, so an MCP client can read and manage the workspace through tools instead of HTTP calls.

- **Endpoint:** `POST {API_URL}/mcp`, the MCP Streamable HTTP transport.
- **Protocol revisions:** `2026-07-28`, `2025-11-25`, `2025-06-18`, `2025-03-26`, and `2024-11-05`.
- **Authentication:** the same API key, in the `x-api-key` header of every request. There is no separate MCP credential and no OAuth flow.

Every endpoint above is one tool, named after the operation it serves — `listTags`, `createPost`, and so on. A tool's input is the endpoint's input as JSON Schema; its result carries the same published DTO as the HTTP response, as structured content and as text. The hints a client shows in an approval prompt — read-only, destructive, idempotent, open world — are the same annotations the endpoint declares.

Scopes, the plan gate, and the per-key rate limit apply exactly as they do to HTTP requests: the key is resolved once per request, and a refusal answers the envelope and status listed under [Errors](#errors). `tools/list` returns every tool regardless of the key's scopes; calling one the key does not hold answers a tool error whose text names the missing scope — `This API key is missing the … scope.` — so a client learns which scope is missing instead of silently lacking a capability.

Requests carrying an `Origin` header are rejected: the transport does not enable cross-origin access, so a browser-based client must reach it through a same-origin proxy. Clients that send no `Origin` — the desktop and server integrations — are unaffected.

## Endpoints

### List boards

```http
GET /api/v1/boards
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |

```json
{
  "data": [
    {
      "id": "brd_feedback",
      "name": "Feedback",
      "slug": "feedback",
      "visibility": "PUBLIC",
      "url": "https://app.feeblo.com/org_example/board/feedback",
      "createdAt": "2026-08-11T00:00:00.000Z",
      "updatedAt": "2026-08-12T09:30:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `boards.read`. Every board of the workspace is returned, private ones included: the key is the workspace's own credential, not a public visitor, so `visibility` tells an integration where its own records appear rather than gating the read. Use this endpoint to resolve the `boardId` a post needs, or the `slug` a public URL contains.

### Get a board

```http
GET /api/v1/boards/{boardId}
```

Returns one board in the shape above. Requires `boards.read`. A board of another workspace is answered with `404 NOT_FOUND` rather than `403`, so an id cannot be used to probe another workspace.

### List statuses

```http
GET /api/v1/statuses
```

```json
{
  "data": [
    {
      "id": "pss_planned",
      "name": "Planned",
      "type": "PLANNED",
      "orderIndex": 2,
      "color": "oklch(0.7 0.15 250)"
    }
  ]
}
```

Requires `posts.read`. Every status of the workspace is returned, in display order, so a caller that creates or moves a post knows the `statusId` to send and the name each one renders as. `name` is the workspace's label, falling back to a humanized `type` when the label is empty — the same rule a post's embedded `status` follows, so one status never has two names across endpoints.

The catalog is the workspace's own: it may rename, recolor, and reorder its statuses, so a caller cannot hard-code them. This endpoint is **not paginated** — a workspace has a handful of statuses and they are ordered by `orderIndex` rather than by age, so there is no cursor and no `nextCursor`.

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
| `tagIds` | — | Comma-separated tag ids; a post matches if it carries **at least one**. At least one id is required when the parameter is present. |
| `updatedAfter` | — | An ISO 8601 date or timestamp; keeps posts changed after it. |

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

### List the workspace's posts

```http
GET /api/v1/posts
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |
| `status` | — | A status id. |
| `includeArchived` | `false` | Archived posts are excluded by default. |
| `boardId` | — | Only posts on this board. |
| `tagIds` | — | Comma-separated tag ids; a post matches if it carries **at least one**. At least one id is required when the parameter is present. |
| `updatedAfter` | — | An ISO 8601 date or timestamp; keeps posts changed after it. |

Returns the same page shape as a board's list, across every board of the calling workspace, newest first. Private boards are included, for the same reason the board list includes them, and posts merged into another post are never listed. Use `GET /api/v1/boards/{boardId}/posts` to page a single board.

To sync incrementally, page the workspace list with `updatedAfter` set to the instant of the last change you processed. It matches posts whose own record changed after it — title, body, status, board, ETA, lock or archive state, a merge, a tag assignment, or the deletion of a tag the post carried — so a caller re-reads each post it returns and gets the current values. Comments and votes are engagement rather than changes to the post, so they do not move `updatedAt`; read those counts from the post itself, or read [`GET /api/v1/posts/{postId}/activity`](#list-a-posts-activity) when the entries themselves are needed. A page is still ordered and cursored by `createdAt`, so an old post that changed recently appears in its original position rather than at the top — page the filtered list to the end, or read it again from the first page.

A `tagIds` parameter that names no id — `?tagIds=`, `?tagIds=,,` — is `400 INVALID_REQUEST` rather than a page of everything: a caller that joins an empty list into the query asked for posts carrying one of nothing. An id that does not exist in the workspace is different: it matches no post rather than being rejected, because a typo should not cost a second request to diagnose.

### Get a post

```http
GET /api/v1/posts/{postId}
```

Returns the same object plus `content`.

### Retrieve a post

```http
GET /api/v1/posts/retrieve?id=pst_example
GET /api/v1/posts/retrieve?boardId=brd_feedback&slug=dark-mode
```

Returns one post with its sanitized body, in the same shape as `GET /api/v1/posts/{postId}`. Requires `posts.read`.

| Query parameter | Notes |
| --- | --- |
| `id` | The post's id. |
| `slug` | The post's slug, the last segment of its public URL. Requires `boardId`. |
| `boardId` | The board the post is on. Required when `slug` is given. |

All three are optional; name the post with `id`, or with the `boardId` and `slug` pair from its URL. Every parameter that is present must match, so an `id` combined with the wrong `boardId` is answered with `404 NOT_FOUND` rather than silently resolved. A request that names neither an `id` nor a `slug` is `400 INVALID_REQUEST`, and so is a `slug` without a `boardId`. Posts of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace.

### Create a post

```http
POST /api/v1/posts
Content-Type: application/json

{
  "boardId": "brd_feedback",
  "title": "Dark mode",
  "content": "Please add a dark theme.",
  "statusId": "pss_open",
  "author": { "email": "jamie@example.com", "name": "Jamie" }
}
```

Responds `201` with the created post, in the same shape `GET /api/v1/posts/{postId}` returns. Requires `posts.create`.

The `id` is assigned by the server. The title is trimmed, the body is sanitized before it is stored, and the `slug` is derived from the title and deduplicated: creating `Dark mode` twice yields `dark-mode` and `dark-mode-2` rather than a conflict. `boardId` and `statusId` must name a board and a status of the calling workspace, and anything else is answered with `400 INVALID_REQUEST` and nothing written.

| Field | Default | Notes |
| --- | --- | --- |
| `boardId` | — | Required. A board id of the workspace, private boards included. |
| `title` | — | Required. Trimmed; must not be empty. |
| `content` | — | Required. Markdown; sanitized before it is stored. |
| `statusId` | — | Required. A status id of the workspace, as returned inside a post's `status`. |
| `etaQuarter` | `null` | `2026-Q3`-style, or omitted. |
| `author` | omitted | The customer the post is attributed to, with the same identifiers and priority order a comment's author uses. Omitted, the post has no author. |
| `createdAt` | write time | Backdates the post, for an import. The list orders by it; `updatedAt` stays the write's clock so a sync still sees the row. |

The post carries `source: API`, and reaches the workspace's integrations, notifications, and search exactly like a submission made in the dashboard. With no `author`, it has **no author**: a machine key is not a member, so `author.displayName` and `author.avatarUrl` are `null` and nobody is subscribed to it as its creator. With an `author`, the post is attributed to the resolved customer — the same on-behalf resolution a comment uses — and that customer is subscribed as its creator; a customer with no account is not provisioned one, because a post needs none. The workspace's admins and owners are notified of the submission the same way a widget submission notifies them. A body may embed the URL of media already in the workspace, but the post is not recorded as referencing it — see [Data exposure](#data-exposure).

### Update a post

```http
PATCH /api/v1/posts/{postId}
Content-Type: application/json

{
  "title": "Dark mode for everyone",
  "statusId": "pss_planned"
}
```

Responds `200` with the post afterwards. Requires `posts.update`.

An omitted field is left as it is and an explicit `null` clears a nullable one, so `"etaQuarter": null` removes the estimate. A body that names no field at all is answered with `400 INVALID_REQUEST` rather than as a write that changed nothing. The `id`, `slug`, vote and comment counts, and timestamps are not writable; changing the title does not change the `slug`, so a link a reader already has keeps working.

| Field | Notes |
| --- | --- |
| `title` | Trimmed; must not be empty. |
| `content` | Markdown; sanitized before it is stored. |
| `statusId` | A status id of the workspace. |
| `boardId` | A board id of the workspace; moves the post. |
| `etaQuarter` | `2026-Q3`-style, or `null` to clear. |
| `author` | Re-attributes the post to the resolved customer, with the same identifiers and priority order a create uses. |

Every change is recorded in the post's timeline, with no actor, and a status change notifies the post's subscribers exactly as the same change from the dashboard would — including the coalescing window, so several quick status changes send one email rather than one each. An author change records `AUTHOR_CHANGED`, retires the previous author's subscription, and subscribes the new author. An image the post already referenced keeps its reference while the body still shows it, and loses it when the body stops; a URL the update introduces is not recorded as a reference, for the same reason a create's is not ([Data exposure](#data-exposure)). A post that has been merged into another is answered with `400 INVALID_REQUEST`: it is still readable, but it is superseded and its changes belong on the survivor.

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

### Delete a post

```http
DELETE /api/v1/posts/{postId}
```

Responds `204` with no body. Requires `posts.delete`.

The post is gone immediately and cannot be restored; its comments, votes, tags, and activity go with it. Unlike the dashboard, a key holding this scope deletes without the creator and engagement restriction — it is the workspace's own credential, not a member acting on their own posts. Deleting a post that had absorbed merged duplicates restores those duplicates to the board first, exactly as the dashboard does.

A post that has been merged into another is answered with `400 INVALID_REQUEST` rather than being deleted, and a post that is already gone is answered with `404 NOT_FOUND` rather than a success that deleted nothing.

### List a post's activity

```http
GET /api/v1/posts/{postId}/activity
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |

```json
{
  "data": [
    {
      "id": "act_example",
      "kind": "STATUS_CHANGED",
      "actor": {
        "type": "member",
        "displayName": "Morgan",
        "avatarUrl": null
      },
      "previousValue": "pss_open",
      "nextValue": "pss_planned",
      "commentId": null,
      "createdAt": "2026-08-12T09:30:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `posts.read`. The post's own history, newest first, so an integration can tell what happened to a post without diffing snapshots. The timeline is append-only: entries are never edited or deleted, and deleting the post takes them with it.

`kind` is the vocabulary that names what happened, and `previousValue` and `nextValue` are the values the entry moved between. What they name depends on `kind`: a status id for `STATUS_CHANGED`, a board id for `BOARD_CHANGED`, a tag id for `TAG_ADDED` and `TAG_REMOVED`, a post id for `POST_MERGED`, `POST_MERGED_INTO`, and `POST_UNMERGED`. `commentId` is set on the comment entries, so a caller can resolve them through `GET /api/v1/comments/{commentId}`.

`actor` is the same `{ type, displayName, avatarUrl }` shape a post's author uses, never an internal identifier. It is `null` when the entry was written by an API key: a machine credential has no member identity, so the alternative would be to invent one. (The dashboard shows the same entry as "Someone".) A post merged into another is still readable and reports its own timeline, including the entry that says where it went.

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

### List a post's votes

```http
GET /api/v1/posts/{postId}/votes
```

| Query parameter | Default | Notes |
| --- | --- | --- |
| `limit` | `25` | 1–100. |
| `cursor` | — | Opaque; pass the `nextCursor` from the previous page. |

```json
{
  "data": [
    {
      "id": "upv_example",
      "postId": "pst_example",
      "author": {
        "type": "end_user",
        "displayName": "Jamie",
        "avatarUrl": null
      },
      "createdAt": "2026-08-11T00:00:00.000Z"
    }
  ],
  "nextCursor": null
}
```

Requires `votes.read`. Votes are returned newest first, on the same cursor as every other list. `author.type` is `member` for a vote cast by a workspace member and `end_user` for everyone else; the account identifier behind the vote is never returned. A post that does not exist in the workspace, or belongs to another one, is `404 NOT_FOUND` rather than an empty page.

A vote belongs to the post it currently lives on. When a post is merged into another, its votes move to the survivor, so ask the survivor for them. The exception is a voter who had already voted on the survivor: their original vote stays on the source — it is what a later unmerge restores — and is not an additional vote on the survivor, so the source can still report that vote.

### Vote on a post

```http
POST /api/v1/posts/{postId}/votes
Content-Type: application/json

{
  "author": { "email": "jamie@example.com", "name": "Jamie" }
}
```

Responds `201` with the vote it added. Requires `votes.create`.

`author` is required and names the customer the vote is attributed to, with the same identifiers and priority order as a comment's author: `userId`, then `contactId`, then `externalId`, then `email`; `name` and `avatarUrl` only enrich the resolved contact. A customer with no account is provisioned a shadow one so the vote has an account behind it, and an email that matches no contact creates one. A subject that resolves to nothing is `400 INVALID_REQUEST`.

Adding a vote the same customer already has is a success no-op that returns the existing vote, so a retried request does not create a duplicate; the vote's id is stable across the retry. A vote records the `VOTE_ADDED` entry in the post's timeline with no actor and subscribes the voter, exactly as adding a voter from the dashboard does. A post that is locked, or that was merged into another, refuses the vote with `409 CONFLICT`.

### Remove a vote

```http
DELETE /api/v1/posts/{postId}/votes/{voteId}
```

Responds `204` with no body. Requires `votes.delete`. The vote is named by its own `id`, not by the voter's account: the account identifier behind a vote is never published, so naming it would require the caller to know an identifier this API deliberately withholds. A vote that is already gone is `404 NOT_FOUND`, and a locked or merged post refuses the removal with `409 CONFLICT`. Removing a vote never touches the voter's email subscription.

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
      "updatedAt": "2026-09-01T00:00:00.000Z",
      "categories": [
        {
          "id": "chc_new",
          "name": "New",
          "iconType": "color",
          "icon": "oklch(0.7 0.15 250)"
        }
      ],
      "linkedPosts": [
        { "id": "pst_dark_mode", "title": "Dark mode", "slug": "dark-mode" }
      ]
    }
  ],
  "nextCursor": null
}
```

Requires `changelog.read`. Entries of every status are returned, newest first — the key is the workspace's own credential, so an integration that syncs release notes sees what has not shipped yet. Pass `status=published` to list only what readers can already see.

`categories` are the entry's labels: the workspace's own vocabulary, each with a name and an `iconType` of `color`, `emoji`, or `icon` that says how to read `icon`. `linkedPosts` are the posts the entry announces, as `{ id, title, slug }` references — read the post itself through `GET /api/v1/posts/{postId}` when the body is needed. Both are set in the dashboard, not through this API, and both are ordered by when they were attached.

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

A `coverImage` that names a workspace media URL is recorded as the entry referencing that asset, so the entry keeps it alive. An image embedded in the body is not recorded as a reference — see [Data exposure](#data-exposure).

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

The fields sent are the entry's new state — the update replaces them rather than merging. `status` is required here, unlike on a create: an update that left it out would move an entry by omission. The same field rules as a create apply to `title`, `slug`, `content`, `coverImage`, `scheduledAt`, and `publishedAt`, and so does the media rule: a `coverImage` referencing a workspace asset is recorded as a reference, a body image is not ([Data exposure](#data-exposure)).

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

The one list that is not a page is [`GET /statuses`](#list-statuses): the status catalog is small and ordered by the workspace's own `orderIndex`, so it is returned whole, with no cursor.

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
| 400 | `INVALID_REQUEST` | Malformed parameter, cursor, limit, `tagIds` list (empty or malformed), or `updatedAfter` instant (not an ISO 8601 date or timestamp naming a real day); a body the endpoint cannot decode; a comment body that is empty or sanitizes to nothing; a name or title that is only whitespace; an update that names no field; a board or status id that is not in the workspace; a post that has been merged into another; a reply whose parent is not a comment on the same post; a reply widened to public beneath an internal parent; an author subject that resolves to no account. |
| 401 | `MISSING_API_KEY` | No `x-api-key` header was sent, or its value was empty. |
| 401 | `INVALID_API_KEY` | The key is unknown, revoked, expired, or disabled. |
| 403 | `FORBIDDEN_SCOPE` | The key lacks the scope the endpoint requires. |
| 403 | `PLAN_REQUIRES_UPGRADE` | The workspace plan does not include the Public API, or has no room left in a limit it sets — such as CRM entries. |
| 404 | `NOT_FOUND` | The resource does not exist in this workspace. |
| 409 | `CONFLICT` | A write collided with something that already exists, such as a tag name or a company name or external id already in use, a changelog slug already taken, a post title whose slug suffixes are all taken, or comments on a post whose conversation is locked. |
| 429 | `RATE_LIMITED` | Per-key rate limit exceeded. Carries `Retry-After` in seconds, and the `X-RateLimit-*` headers described under [Rate limits](#rate-limits). |
| 500 | `INTERNAL_ERROR` | Unexpected server failure. |
| 503 | `SERVICE_UNAVAILABLE` | A required dependency is unavailable; requests fail closed. |

Switch on `_tag`. Codes are append-only within v1 — a new one may appear, an existing one never changes meaning — and `message` is for humans and may change at any time. Each code appears as its own response, with the status above, in the OpenAPI document.

## Rate limits

Limits are per key, not per IP, and are shared across server instances: **300 requests per minute**, shared by reads and writes. Limits may increase without notice; decreases are announced in advance.

Every successful response, and every `429`, carries the state of the caller's budget:

| Header | Meaning |
| --- | --- |
| `X-RateLimit-Limit` | Requests allowed in the current window. |
| `X-RateLimit-Remaining` | Requests left in the window after this one. |
| `X-RateLimit-Reset` | When this budget next allows a request, as a Unix timestamp in seconds. |

A request refused before it spends a budget — a missing or invalid key, or a workspace whose plan does not include the API — has no window to describe and carries none of them. The same three headers are sent on the `/mcp` transport.

The per-key bucket means a customer behind a shared NAT is not throttled by their neighbours, and a leaked key cannot escape its limit by rotating source IPs. When the limit is exceeded the API returns `429 RATE_LIMITED` with `Retry-After` and the three headers above. If the rate limiter itself is unavailable, requests fail closed with `503 SERVICE_UNAVAILABLE` rather than being admitted unlimited.

## Plans

The Public API is included in **Starter** and **Professional**. A workspace on the Free plan cannot create keys, and requests made with keys from a workspace that has downgraded return `403 PLAN_REQUIRES_UPGRADE`.

On downgrade, keys are **kept and not disabled**. They start working again when the workspace upgrades, with no rotation and no reconfiguration in your integrations. Existing keys stay listed and can still be revoked while the workspace is on Free — only creating new ones is blocked.

## Data exposure

The Public API never returns:

- end-user email addresses, phone numbers, or contact records;
- internal actor identifiers — `usr_*`, `mem_*`, `cnt_*`;
- IP addresses, credentials, webhook secrets, or API keys.

`author` is always `{ type, displayName, avatarUrl }`: `type` is `member` or `end_user` and distinguishes workspace staff from end users. Display names are included because the workspace already sees them on public boards and the dashboard; they are the workspace's own data. Emails are deliberately excluded — a key travels into third-party infrastructure (an integration platform, a partner's backend, a CI log), and that is a different blast radius from a signed-in session.

A post created or changed with an API key has **no actor**: a machine key is not a member, so the entries the API writes to the post's timeline have no actor, and the dashboard shows them as "Someone". A post created or re-attributed with an `author` carries the resolved customer's display name and avatar — the same identity-only `{ type, displayName, avatarUrl }` a comment and a vote carry — and never the account identifier behind it. Without an `author`, the post's `author` has `null` display name and avatar.

Changelog entries carry no author at all: the dashboard's entry rows hold `creatorId` and `creatorMemberId`, and neither has a field in this API. Publishing through the API records the email intent and the in-app notification with no actor, exactly as a key's tag changes have no actor in a post's timeline.

Post and changelog `content` is sanitized before it is stored, so the body the API returns is the same sanitized content the dashboard and the public portal render. Editor media is the one thing a body can name that the API does not manage: a dashboard editor submits the ids of the media it attached, and those ids are what record which posts and entries reference an asset, while a machine key has none to submit. A body may still embed a workspace media URL, but the resource is not recorded as referencing it, so media whose only remaining use is such a body can be removed by the workspace's own cleanup — keep the asset attached to a dashboard-authored post or entry, or host the image yourself. A changelog entry's `coverImage` is the exception: it is resolved by URL and does keep its asset. Tags carry a name and a slug, nothing else — a tag's creator is an internal identifier and is never returned.

Comments follow the same rule. A comment payload carries its author as `{ type, displayName, avatarUrl }`, never the `userId` or `memberId` the dashboard's comment rows hold, and its `content` is the sanitized body the dashboard and portal render. A comment's merge and status-transition provenance (`mergedFromPostId`, `statusUpdateId`) is not part of the resource either: it describes internal bookkeeping, not the comment a caller reads. A comment created with a key is attributed to the resolved customer, so nothing in the payload points back at the key that wrote it.

Votes follow the same rule. A vote payload carries its voter as `{ type, displayName, avatarUrl }`, never the `userId` or `memberId` behind it, and never the merge provenance a moved vote keeps. A vote added with a key is attributed to the resolved customer, so nothing in the payload points back at the key that wrote it.

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

When a key is created you choose its capabilities with one checkbox each: **Manage posts**, **Manage comments**, **Manage votes**, **Manage tags**, **Manage changelog**, and **Manage companies**. Every key reads the workspace's posts, comments, votes, tags, and changelog entries; a capability is the write half of one of those, and publishing is part of the changelog choice because it emails subscribers. The CRM capability is opt-in as a whole — reads included — because a company is a record about the workspace's own customers rather than the workspace's content. The choice fixes the key's scopes for its whole life, so pick the narrowest set the integration needs.

Use one key per integration so that revoking one does not interrupt the others.
