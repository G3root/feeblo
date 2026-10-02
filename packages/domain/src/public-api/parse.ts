import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  PUBLIC_API_PAGE_DEFAULT_LIMIT,
  PUBLIC_API_PAGE_MAX_LIMIT,
} from "./common";
import { invalidRequestError } from "./errors";

/**
 * Input normalization shared by the endpoint projections and the operations.
 *
 * Query parameters are declared as strings and validated here rather than
 * typed in the endpoint schema: a typed parameter makes the framework reject a
 * malformed request with its own error body, which is not this API's published
 * envelope. Every failure below is an `INVALID_REQUEST` carrying a message
 * about the field the caller actually sent.
 *
 * `parseLimit`/`parseIncludeArchived`/`providedQueryParam` belong to the HTTP
 * projection, which is the only surface with string inputs; `parseName` and
 * `parseTitle` are called from operations too, so an MCP tool or a CLI trims
 * exactly as the API does.
 */

export const parseLimit = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return PUBLIC_API_PAGE_DEFAULT_LIMIT;
    }

    if (!/^\d+$/.test(raw)) {
      return yield* invalidRequestError("limit must be a positive integer.");
    }

    const limit = Number(raw);
    if (limit < 1 || limit > PUBLIC_API_PAGE_MAX_LIMIT) {
      return yield* invalidRequestError(
        `limit must be between 1 and ${PUBLIC_API_PAGE_MAX_LIMIT}.`
      );
    }

    return limit;
  });

export const parseIncludeArchived = (raw: string | undefined) => {
  if (raw === undefined || raw.length === 0 || raw === "false") {
    return Effect.succeed(false);
  }
  if (raw === "true") {
    return Effect.succeed(true);
  }
  return Effect.fail(
    invalidRequestError("includeArchived must be true or false.")
  );
};

/**
 * A comma-separated list of tag ids on a query string.
 *
 * Absent, blank, and whitespace-only are all "no tag filter", so `?tagIds=`
 * does not become a filter that matches nothing. An id that does not exist in
 * the workspace simply matches no post: unlike assigning tags, filtering is a
 * read, so a mistyped id is answered with an empty page rather than a
 * rejection that would cost a second query to distinguish.
 */
export const parseTagIds = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.trim().length === 0) {
      return null;
    }

    const tagIds = raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    if (tagIds.length === 0) {
      return yield* invalidRequestError(
        "tagIds must be a comma-separated list of tag ids."
      );
    }

    return tagIds;
  });

const decodeUpdatedAfter = Schema.decodeUnknownOption(Schema.DateFromString);

/**
 * An ISO-8601 instant that bounds a list to the rows changed after it.
 *
 * A bare date is accepted (`2026-08-11`, midnight UTC) as well as a full
 * timestamp, because a caller catching up day by day does not have to spell out
 * the midnight. Anything else is the caller's mistake and is reported as one,
 * rather than being silently ignored as an unfiltered list.
 */
export const parseUpdatedAfter = (raw: string | undefined) =>
  Effect.gen(function* () {
    const trimmed = raw?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      return null;
    }

    const decoded = Option.getOrNull(decodeUpdatedAfter(trimmed));
    if (decoded === null) {
      return yield* invalidRequestError(
        "updatedAfter must be an ISO 8601 date or timestamp."
      );
    }

    return decoded;
  });

/**
 * Tag and company names are trimmed before they are stored or compared.
 *
 * Without this, `" UI "` and `"UI"` are two different names that produce the
 * same tag slug, so the second one is rejected by an index the caller cannot
 * see; and a company named `" Acme "` would sit beside `"Acme"` until someone
 * looked. An all-whitespace name is not a name at all.
 */
export const parseName = (raw: string) =>
  Effect.gen(function* () {
    const name = raw.trim();
    if (name.length === 0) {
      return yield* invalidRequestError("name must not be empty.");
    }
    return name;
  });

/**
 * Post titles are trimmed before they are stored or slugified.
 *
 * Without this, `" Dark mode "` and `"Dark mode"` are two titles whose slugs
 * are one, and an all-whitespace title is not a title at all. The dashboard's
 * own title schema trims for the same reason.
 */
export const parseTitle = (raw: string) =>
  Effect.gen(function* () {
    const title = raw.trim();
    if (title.length === 0) {
      return yield* invalidRequestError("title must not be empty.");
    }
    return title;
  });

/**
 * A query parameter that names something.
 *
 * Absent, blank, and whitespace-only are all "not provided", so `?id=` does
 * not become a lookup for the empty string and cannot be used to probe what an
 * empty identifier would match.
 */
export const providedQueryParam = (raw: string | undefined) => {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};
