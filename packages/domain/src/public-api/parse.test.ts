import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "./common";
import {
  isIsoDateOrTimestamp,
  parseIncludeArchived,
  parseLimit,
  parseName,
  parseTagIds,
  parseTitle,
  parseUpdatedAfter,
  providedQueryParam,
} from "./parse";

/**
 * Direct tests for the input normalization shared by the Public API surfaces.
 *
 * These helpers are the whole of a query parameter's or an operation input's
 * validation: the endpoint projections call them before an operation runs, and
 * the operations call the name and title parsers themselves. Reaching them
 * through a PGlite database and an HTTP request would test the same branches
 * at a hundred times the cost, so each branch is one call away here and a
 * failure names the helper it belongs to.
 */

/** The tag every refusal these helpers produce carries. */
const isInvalidRequest = (result: Result.Result<unknown, { _tag: string }>) =>
  Result.isFailure(result) && result.failure._tag === "INVALID_REQUEST";

describe("public api parse helpers", () => {
  it.effect("defaults an absent page size and bounds a present one", () =>
    Effect.gen(function* () {
      expect(yield* parseLimit(undefined)).toBe(PUBLIC_API_PAGE_DEFAULT_LIMIT);
      expect(yield* parseLimit("")).toBe(PUBLIC_API_PAGE_DEFAULT_LIMIT);
      expect(yield* parseLimit("1")).toBe(1);
      expect(yield* parseLimit("100")).toBe(100);

      for (const raw of ["0", "101", "-1", "many", "1.5"]) {
        expect(isInvalidRequest(yield* Effect.result(parseLimit(raw)))).toBe(
          true
        );
      }
    })
  );

  it.effect("reads includeArchived as a strict boolean", () =>
    Effect.gen(function* () {
      for (const raw of [undefined, "", "false"]) {
        expect(yield* parseIncludeArchived(raw)).toBe(false);
      }
      expect(yield* parseIncludeArchived("true")).toBe(true);

      for (const raw of ["TRUE", "1", "yes"]) {
        expect(
          isInvalidRequest(yield* Effect.result(parseIncludeArchived(raw)))
        ).toBe(true);
      }
    })
  );

  it.effect("splits a tag filter and refuses a present-but-empty one", () =>
    Effect.gen(function* () {
      expect(yield* parseTagIds(undefined)).toBeNull();
      expect(yield* parseTagIds("tag_ui,tag_api")).toEqual([
        "tag_ui",
        "tag_api",
      ]);
      expect(yield* parseTagIds(" tag_ui ,, tag_api ")).toEqual([
        "tag_ui",
        "tag_api",
      ]);

      // A caller that joined an empty array asked for posts carrying one of
      // nothing; an unfiltered page is the opposite of what it asked.
      for (const raw of ["", ",", " , "]) {
        expect(isInvalidRequest(yield* Effect.result(parseTagIds(raw)))).toBe(
          true
        );
      }
    })
  );

  it("checks a date's shape and its calendar, not only its parseability", () => {
    expect(isIsoDateOrTimestamp("2026-08-11")).toBe(true);
    expect(isIsoDateOrTimestamp("2026-08-11T12:30:00.000Z")).toBe(true);
    expect(isIsoDateOrTimestamp("2026-08-11T12:30+05:30")).toBe(true);
    expect(isIsoDateOrTimestamp("2024-02-29")).toBe(true);

    // Host formats and rolled-over days are the two failure modes the shape
    // check exists for: a typo must not silently filter from March 2.
    expect(isIsoDateOrTimestamp("August 11, 2026")).toBe(false);
    expect(isIsoDateOrTimestamp("2026/08/11")).toBe(false);
    expect(isIsoDateOrTimestamp("2026-02-30")).toBe(false);
    expect(isIsoDateOrTimestamp("2026-13-01")).toBe(false);
    expect(isIsoDateOrTimestamp("2026-02-29")).toBe(false);
    expect(isIsoDateOrTimestamp("2026-08-11T24:00")).toBe(false);
    expect(isIsoDateOrTimestamp("2026-08-11T12:61")).toBe(false);
  });

  it.effect("turns an updatedAfter value into the instant it names", () =>
    Effect.gen(function* () {
      expect(yield* parseUpdatedAfter(undefined)).toBeNull();
      expect(yield* parseUpdatedAfter("   ")).toBeNull();

      const date = yield* parseUpdatedAfter("2026-08-11");
      expect(date?.toISOString()).toBe("2026-08-11T00:00:00.000Z");

      const instant = yield* parseUpdatedAfter("2026-08-11T12:30:00.000Z");
      expect(instant?.toISOString()).toBe("2026-08-11T12:30:00.000Z");

      for (const raw of ["2026-02-30", "August 11, 2026", "yesterday"]) {
        expect(
          isInvalidRequest(yield* Effect.result(parseUpdatedAfter(raw)))
        ).toBe(true);
      }
    })
  );

  it.effect(
    "trims a name or title and refuses one that is only whitespace",
    () =>
      Effect.gen(function* () {
        expect(yield* parseName("  UI  ")).toBe("UI");
        expect(yield* parseTitle("  Dark mode  ")).toBe("Dark mode");

        expect(isInvalidRequest(yield* Effect.result(parseName("   ")))).toBe(
          true
        );
        expect(isInvalidRequest(yield* Effect.result(parseTitle("   ")))).toBe(
          true
        );
      })
  );

  it("treats a blank query parameter as not provided", () => {
    expect(providedQueryParam(undefined)).toBeUndefined();
    expect(providedQueryParam("")).toBeUndefined();
    expect(providedQueryParam("   ")).toBeUndefined();
    expect(providedQueryParam("  pst_1  ")).toBe("pst_1");
  });
});
