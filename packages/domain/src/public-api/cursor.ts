import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/**
 * Opaque page cursors.
 *
 * A cursor is the sort key of the last row of the previous page, base64url
 * encoded so callers treat it as opaque. It is deliberately *not* signed: it
 * carries a timestamp and a post id the caller already received, and every
 * query that consumes it is scoped to the calling workspace, so a forged cursor
 * can only move a caller around its own data.
 */
const CursorPayload = Schema.Struct({
  createdAt: Schema.DateFromString,
  id: Schema.String,
});

export type Cursor = Schema.Schema.Type<typeof CursorPayload>;

const decodeCursorPayload = Schema.decodeUnknownOption(
  Schema.fromJsonString(CursorPayload)
);

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

/**
 * Returns `None` for anything that is not a well-formed cursor, so malformed
 * input becomes a documented `INVALID_REQUEST` rather than a query that pages
 * from an arbitrary offset.
 */
export const decodeCursor = (value: string): Option.Option<Cursor> =>
  decodeCursorPayload(Buffer.from(value, "base64url").toString("utf8"));
