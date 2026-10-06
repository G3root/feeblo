import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import { paramsOf, payloadOf } from "../../public-api/http-input";

/**
 * The tag resource: what the tag endpoints return, and the typed input every
 * tag operation takes.
 *
 * The `*Input` schemas are what an operation receives — typed values, so a
 * surface that already has types (MCP, a CLI) has nothing to parse — and they
 * are the authority for the constraints a request obeys. A `*Payload` and a
 * `*Params` are the HTTP body and path projected from that input; query
 * parameters are still strings validated in the endpoint's handler so a
 * malformed request stays on the published error envelope. See
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

/**
 * The name is the only writable field.
 *
 * `slug` is derived from it on every write, exactly as the dashboard derives
 * it, so the two surfaces cannot disagree about what a tag is called.
 */
export const CreateTagInput = Schema.Struct({
  name: Schema.String.annotate({ description: "The tag's display name" }),
});

/** The create body: the operation input with no path field to remove. */
export const CreateTagPayload = payloadOf(CreateTagInput, []);

export type TCreateTagPayload = Schema.Schema.Type<typeof CreateTagPayload>;

export const UpdateTagInput = Schema.Struct({
  tagId: Schema.String,
  name: Schema.String.annotate({ description: "The tag's new display name" }),
});

/** The tag the URL names, taken from the operation input. */
export const UpdateTagParams = paramsOf(UpdateTagInput, ["tagId"]);

/** The update body: the operation input without the tag the URL names. */
export const UpdateTagPayload = payloadOf(UpdateTagInput, ["tagId"]);

export type TUpdateTagPayload = Schema.Schema.Type<typeof UpdateTagPayload>;

/** Typed input for a page of the workspace's tags. */
export const ListTagsInput = Schema.Struct({
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
});

export type TListTagsInput = Schema.Schema.Type<typeof ListTagsInput>;

/** Typed input for reading one tag. */
export const GetTagInput = Schema.Struct({
  tagId: Schema.String,
});

/** The tag the URL names, taken from the operation input. */
export const GetTagParams = paramsOf(GetTagInput, ["tagId"]);

/** Typed input for deleting a tag. */
export const DeleteTagInput = Schema.Struct({
  tagId: Schema.String,
});

/** The tag the URL names, taken from the operation input. */
export const DeleteTagParams = paramsOf(DeleteTagInput, ["tagId"]);
