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
 * projection, which is the only surface with string inputs. `parseName` and
 * `parseTitle` are called from operations instead, so every surface refuses
 * an all-whitespace name or title with the same field-specific message; a
 * post title reaches `parseTitle` already trimmed by the operation input's own
 * `PostTitle`, and the handler is what rejects one that trimmed to nothing.
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
 * Absent is "no tag filter". A parameter that is *present* but names no id —
 * `?tagIds=`, `?tagIds=,,` — is `INVALID_REQUEST` rather than an unfiltered
 * list: a caller that joins an empty array into the parameter asked for posts
 * carrying one of nothing, and handing it every post silently is the opposite
 * of what it asked. An id that does not exist in the workspace simply matches
 * no post: unlike assigning tags, filtering is a read, so a mistyped id is
 * answered with an empty page rather than a rejection that would cost a
 * second query to distinguish.
 */
export const parseTagIds = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined) {
      return null;
    }

    const tagIds = raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0);

    // Built as a tuple rather than returned as the filtered array: the
    // operation's input schema is a non-empty array, so the empty case is
    // unrepresentable past this point rather than merely unreachable.
    const [first, ...rest] = tagIds;
    if (first === undefined) {
      return yield* invalidRequestError(
        "tagIds must be a comma-separated list of tag ids."
      );
    }

    const nonEmpty: readonly [string, ...string[]] = [first, ...rest];
    return nonEmpty;
  });

/**
 * The shape an `updatedAfter` value must have before it is decoded.
 *
 * A date-only value, or a datetime with at least hours and minutes, an
 * optional seconds-and-fraction part, and an optional timezone. Date and
 * time components are captured separately because the shape alone cannot
 * reject a date that names no day. Both `+05:30` and `+0530` offsets are
 * accepted: both are ISO 8601, and refusing the basic form would be a
 * narrowing the contract never promised.
 */
const ISO_DATE_OR_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

const daysInMonth = (year: number, month: number): number => {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
};

/**
 * True when `value` is an ISO 8601 date or timestamp that names a real
 * instant.
 *
 * `Schema.DateFromString` is not enough on its own: it falls back to the
 * host's date parsing, which accepts `August 11, 2026` and `2026/08/11`, and
 * it *rolls over* a day that does not exist — `2026-02-30` becomes March 2 —
 * so a caller with a typo in a sync cursor would silently filter from the
 * wrong day. The shape check keeps the value ISO (the contract the document
 * promises) and the component check keeps it a real calendar date.
 *
 * Shared with the post `createdAt` codec, which decodes a raw date string the
 * same way: the two must not disagree about which strings are real dates.
 */
export const isIsoDateOrTimestamp = (value: string): boolean => {
  const match = ISO_DATE_OR_DATETIME.exec(value);
  if (match === null) {
    return false;
  }

  const [, year, month, day, hour, minute, second] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);

  if (monthNumber < 1 || monthNumber > 12) {
    return false;
  }
  if (dayNumber < 1 || dayNumber > daysInMonth(Number(year), monthNumber)) {
    return false;
  }
  if (hour !== undefined && Number(hour) > 23) {
    return false;
  }
  if (minute !== undefined && Number(minute) > 59) {
    return false;
  }
  if (second !== undefined && Number(second) > 59) {
    return false;
  }

  return true;
};

const decodeUpdatedAfter = Schema.decodeUnknownOption(Schema.DateFromString);

const UPDATED_AFTER_INVALID =
  "updatedAfter must be an ISO 8601 date or timestamp naming a real date.";

/**
 * An ISO-8601 instant that bounds a list to the rows changed after it.
 *
 * A bare date is accepted (`2026-08-11`, midnight UTC) as well as a full
 * timestamp, because a caller catching up day by day does not have to spell out
 * the midnight. Anything that is not an ISO 8601 date or timestamp naming a
 * real day — `2026-02-30`, `August 11, 2026`, `yesterday` — is the caller's
 * mistake and is reported as one, rather than being silently ignored as an
 * unfiltered list or, worse, quietly rolled into the next month.
 *
 * Blank is still "no filter": a caller's first sync has no cursor yet, and an
 * empty string is how that is spelt in a query it builds.
 */
export const parseUpdatedAfter = (raw: string | undefined) =>
  Effect.gen(function* () {
    const trimmed = raw?.trim();
    if (trimmed === undefined || trimmed.length === 0) {
      return null;
    }

    if (!isIsoDateOrTimestamp(trimmed)) {
      return yield* invalidRequestError(UPDATED_AFTER_INVALID);
    }

    const decoded = Option.getOrNull(decodeUpdatedAfter(trimmed));
    if (decoded === null) {
      // Unreachable while the shape and calendar checks above hold; kept so
      // the decoder remains the authority on what an instant is rather than
      // the regex.
      return yield* invalidRequestError(UPDATED_AFTER_INVALID);
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
 * A post title that is not empty, so the refusal names the field.
 *
 * The operation input's `PostTitle` has already trimmed the value and bounded
 * its length, so this is the one rule the schema deliberately leaves to the
 * handler: `"   "` is not a title at all, and answering it here keeps the
 * message about the field the caller sent instead of a schema issue that names
 * the whole body.
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
