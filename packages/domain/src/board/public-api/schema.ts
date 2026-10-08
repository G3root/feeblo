import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";
import { paramsOf } from "../../public-api/http-input";

/**
 * The board resource: what the board endpoints return, and the typed input
 * every board operation takes.
 *
 * The `*Query`/`*Params` schemas below describe the HTTP projection: query
 * parameters are strings validated in the endpoint's handler so a malformed
 * request stays on the published error envelope. The `*Input` schemas are what
 * an operation actually receives — typed values, so a surface that already has
 * types (MCP, a CLI) has nothing to parse. See `public-api/operation.ts`.
 */

/**
 * A board as the workspace's own credential reads it.
 *
 * One projection rather than a summary and a detail: a board has no body, so
 * there is nothing for a list to leave out. `visibility` is the workspace's
 * own setting — a key reads private boards too, so the field tells an
 * integration which boards its records will be visible on, not which ones it
 * may read. The workspace is not named: a key reads exactly one workspace, so
 * the field would be the same string on every response.
 */
export const PublicApiBoard = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  visibility: Schema.Literals(["PUBLIC", "PRIVATE"]),
  url: Schema.String,
  createdAt: Schema.DateFromString,
  updatedAt: Schema.DateFromString,
});

export type TPublicApiBoard = Schema.Schema.Type<typeof PublicApiBoard>;

export const PublicApiBoardPage = Schema.Struct({
  data: Schema.Array(PublicApiBoard),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiBoardPage = Schema.Schema.Type<typeof PublicApiBoardPage>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListBoardsQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
});

/** Typed input for a page of the workspace's boards. */
export const ListBoardsInput = Schema.Struct({
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

export type TListBoardsInput = Schema.Schema.Type<typeof ListBoardsInput>;

/** Typed input for reading one board. */
export const GetBoardInput = Schema.Struct({
  boardId: Schema.String,
});

/** The board the URL names, taken from the operation input. */
export const GetBoardParams = paramsOf(GetBoardInput, ["boardId"]);
