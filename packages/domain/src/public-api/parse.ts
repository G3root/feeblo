import * as Effect from "effect/Effect";

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
