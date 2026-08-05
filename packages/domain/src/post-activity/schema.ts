import { PostActivityKind } from "@feeblo/db";
import { PostId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

/**
 * `PostActivityKind` comes from `@feeblo/db/activity-kind` — the canonical
 * vocabulary the `post_activity.kind` column type is derived from.
 */

export const PostActivity = S.Struct({
  id: S.String,
  organizationId: S.String,
  postId: S.String,
  actorId: S.NullOr(S.String),
  actorMemberId: S.NullOr(S.String),
  actor: S.Struct({
    name: S.NullOr(S.String),
    image: S.NullOr(S.String),
  }),
  kind: PostActivityKind,
  previousValue: S.NullOr(S.String),
  nextValue: S.NullOr(S.String),
  commentId: S.NullOr(S.String),
  createdAt: S.DateFromString,
});

export type TPostActivity = S.Schema.Type<typeof PostActivity>;

export const PostActivityList = S.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
  since: S.optional(S.DateFromString),
});

export type TPostActivityList = S.Schema.Type<typeof PostActivityList>;
