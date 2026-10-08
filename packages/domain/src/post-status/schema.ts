import { PostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { PostStatusId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

// Re-exported so client packages can use the status vocabulary and the default
// resolution without importing `@feeblo/db` directly.
export {
  DEFAULT_POST_STATUS_TYPE,
  pickDefaultPostStatus,
} from "@feeblo/domain-contracts/post-status-default";
export {
  POST_STATUS_TYPES,
  PostStatusType,
  type TPostStatusType,
} from "@feeblo/domain-contracts/post-status-type";

/**
 * The fields a status row carries. Declared once so the read model and the
 * write payloads cannot drift from each other.
 *
 * `isDefault` is the status a post lands in when no status is named, and the
 * one status a workspace may not delete. It is part of the read model rather
 * than an admin-only field because the create form is shared by the dashboard,
 * the public board and the widget: all three prefill the default status, and
 * the latter two read the catalog anonymously.
 */
const PostStatusFields = {
  id: S.String,
  type: PostStatusType,
  label: S.String,
  color: S.optional(S.NullOr(S.String)),
  orderIndex: S.Finite,
  isDefault: S.Boolean,
  organizationId: S.String,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
} as const;

export const PostStatus = S.Struct(PostStatusFields);

export type TPostStatus = S.Schema.Type<typeof PostStatus>;

export const PostStatusList = S.Struct({
  organizationId: S.String,
});

export type TPostStatusList = S.Schema.Type<typeof PostStatusList>;

/**
 * A status is named by the client so the optimistic row the dashboard inserts
 * has its final id before the write lands, the same way roadmap columns and
 * tags work.
 *
 * `orderIndex` is client-supplied for the same reason: the settings page
 * appends a new status to the end of its section, so it can compute the next
 * position. A position that collides with an existing one is remapped to a
 * `BadRequestError` rather than silently renumbering the workspace.
 */
export const PostStatusCreate = S.Struct({
  id: PostStatusId.schema,
  organizationId: WorkspaceId.schema,
  type: PostStatusType,
  label: S.String.check(S.isBetweenLength(1, 60)),
  color: S.NullOr(S.String),
  orderIndex: S.Int,
});

export type TPostStatusCreate = S.Schema.Type<typeof PostStatusCreate>;

/**
 * `type` is writable, which is how a status moves between the sections on the
 * settings page. A status that changes type is appended to the end of its new
 * section rather than keeping a position that means nothing there.
 */
export const PostStatusUpdate = S.Struct({
  id: PostStatusId.schema,
  organizationId: WorkspaceId.schema,
  type: PostStatusType,
  label: S.String.check(S.isBetweenLength(1, 60)),
  color: S.NullOr(S.String),
});

export type TPostStatusUpdate = S.Schema.Type<typeof PostStatusUpdate>;

export const PostStatusDelete = S.Struct({
  id: PostStatusId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostStatusDelete = S.Schema.Type<typeof PostStatusDelete>;

/**
 * Reorders one section. Drag never crosses a section boundary — moving a
 * status to another type is the edit dialog's `type` field — so the payload
 * names a single type and the full order of its statuses.
 */
export const PostStatusReorder = S.Struct({
  organizationId: WorkspaceId.schema,
  type: PostStatusType,
  orderedIds: S.Array(PostStatusId.schema),
});

export type TPostStatusReorder = S.Schema.Type<typeof PostStatusReorder>;

/**
 * What a delete would do, read before it runs.
 *
 * Deliberately not a field on the status list: the list is read by the board
 * on every route, and the three counts are only ever needed to fill in one
 * confirmation dialog. Keeping them here also lets the dialog name the
 * configuration it is about to remove, which a bare post count cannot.
 */
export const PostStatusDeletePreview = S.Struct({
  id: PostStatusId.schema,
  organizationId: WorkspaceId.schema,
});

export type TPostStatusDeletePreview = S.Schema.Type<
  typeof PostStatusDeletePreview
>;

export const PostStatusDeletePreviewResult = S.Struct({
  postCount: S.Int,
  roadmapColumnCount: S.Int,
  syncRuleCount: S.Int,
});

export type TPostStatusDeletePreviewResult = S.Schema.Type<
  typeof PostStatusDeletePreviewResult
>;

/**
 * What a delete actually did. Returned rather than `Void` so the dashboard can
 * report the truth in its toast instead of repeating the estimate the
 * confirmation dialog showed.
 *
 * `removedSyncRuleCount` is the cascade the database performs on
 * `github_sync_rule`, counted before the delete so the dialog can name it: a
 * sync rule is configuration a workspace may not connect to the status it is
 * about to remove.
 */
export const PostStatusDeleteResult = S.Struct({
  movedPostCount: S.Int,
  removedRoadmapColumnCount: S.Int,
  removedSyncRuleCount: S.Int,
});

export type TPostStatusDeleteResult = S.Schema.Type<
  typeof PostStatusDeleteResult
>;
