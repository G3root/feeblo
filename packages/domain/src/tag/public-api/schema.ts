import * as Schema from "effect/Schema";

import { PublicApiTag } from "../../public-api/common";

/**
 * The tag resource: what the tag endpoints return, and the typed input every
 * tag operation takes.
 *
 * The `*Query`/`*Params`/`*Payload` schemas below describe the HTTP projection:
 * query parameters are strings validated in the endpoint's handler so a
 * malformed request stays on the published error envelope. The `*Input`
 * schemas are what an operation actually receives — typed values, so a surface
 * that already has types (MCP, a CLI) has nothing to parse. See
 * `public-api/operation.ts`.
 */

/**
 * The tag resource: what the tag endpoints return.
 *
 * Separate from `PublicApiTag` rather than a widening of it, so adding a field
 * to a tag does not silently change every post payload that embeds one. The
 * workspace is not named: a key reads exactly one workspace, so the field
 * would be the same string on every response.
 */
export const PublicApiTagDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiTagDetail = Schema.Schema.Type<typeof PublicApiTagDetail>;

export const PublicApiTagPage = Schema.Struct({
  data: Schema.Array(PublicApiTagDetail),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiTagPage = Schema.Schema.Type<typeof PublicApiTagPage>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListTagsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

export const GetTagParams = Schema.Struct({
  tagId: Schema.String,
});

/**
 * The name is the only writable field.
 *
 * `slug` is derived from it on every write, exactly as the dashboard derives
 * it, so the two surfaces cannot disagree about what a tag is called.
 */
export const CreateTagPayload = Schema.Struct({
  name: Schema.String,
});

export type TCreateTagPayload = Schema.Schema.Type<typeof CreateTagPayload>;

export const UpdateTagParams = Schema.Struct({
  tagId: Schema.String,
});

export const UpdateTagPayload = Schema.Struct({
  name: Schema.String,
});

export type TUpdateTagPayload = Schema.Schema.Type<typeof UpdateTagPayload>;

export const DeleteTagParams = Schema.Struct({
  tagId: Schema.String,
});

/**
 * The complete set of tags a post should carry.
 *
 * A replacement rather than add and remove calls: the dashboard's own tag
 * picker works this way, and a caller that states the final set cannot leave a
 * tag behind by forgetting to remove it. An empty array clears the post.
 */
export const SetPostTagsPayload = Schema.Struct({
  tagIds: Schema.Array(Schema.String),
});

export type TSetPostTagsPayload = Schema.Schema.Type<typeof SetPostTagsPayload>;

export const SetPostTagsParams = Schema.Struct({
  postId: Schema.String,
});

/**
 * The tags a post carries after a write.
 *
 * The embedded tag shape, not the tag resource: these are references to tags,
 * and a caller that wants a slug or a timestamp reads the tag itself.
 */
export const PublicApiPostTags = Schema.Struct({
  data: Schema.Array(PublicApiTag),
});

export type TPublicApiPostTags = Schema.Schema.Type<typeof PublicApiPostTags>;

/** Typed input for a page of the workspace's tags. */
export const ListTagsInput = Schema.Struct({
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(Schema.isInt(), Schema.isGreaterThan(0)).annotate({
      description: "Page size, 1–100",
    })
  ),
});

export type TListTagsInput = Schema.Schema.Type<typeof ListTagsInput>;

/** Typed input for reading one tag. */
export const GetTagInput = Schema.Struct({
  tagId: Schema.String,
});

/** Typed input for creating a tag. */
export const CreateTagInput = Schema.Struct({
  name: Schema.String.annotate({ description: "The tag's display name" }),
});

/** Typed input for renaming a tag. */
export const UpdateTagInput = Schema.Struct({
  tagId: Schema.String,
  name: Schema.String.annotate({ description: "The tag's new display name" }),
});

/** Typed input for deleting a tag. */
export const DeleteTagInput = Schema.Struct({
  tagId: Schema.String,
});

/** Typed input for replacing the tags a post carries. */
export const SetPostTagsInput = Schema.Struct({
  postId: Schema.String,
  tagIds: Schema.Array(Schema.String).annotate({
    description: "The complete set of tag ids the post should carry",
  }),
});
