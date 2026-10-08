import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Result from "effect/Result";

import { decodeCursor, decodeCursorOrFail, encodeCursor } from "./cursor";

/**
 * Direct tests for the opaque page cursor.
 *
 * The cursor is a base64url sort key, deliberately unsigned: every query that
 * consumes one is scoped to the calling workspace, so a forged cursor can only
 * move a caller around its own data. What has to hold is that a cursor a
 * previous page returned reads back, and that anything else is reported as a
 * malformed request instead of paging from an arbitrary offset.
 */

/** The cursor a previous page returned, built through `DateTime`. */
const cursorAt = (instant: string) => ({
  createdAt: DateTime.toDateUtc(DateTime.makeUnsafe(instant)),
  id: "pst_1",
});

describe("public api page cursors", () => {
  it("round-trips a cursor through its opaque encoding", () => {
    const cursor = cursorAt("2026-08-11T12:30:00.000Z");

    const decoded = decodeCursor(encodeCursor(cursor));
    expect(Option.isSome(decoded)).toBe(true);
    expect(Option.getOrNull(decoded)).toEqual(cursor);
  });

  it("reads a malformed cursor as None rather than a value", () => {
    expect(Option.isNone(decodeCursor("not-a-cursor"))).toBe(true);
    expect(
      Option.isNone(
        decodeCursor(Buffer.from('{"id":1}', "utf8").toString("base64url"))
      )
    ).toBe(true);
    expect(
      Option.isNone(
        decodeCursor(
          Buffer.from('{"createdAt":"nope","id":"x"}', "utf8").toString(
            "base64url"
          )
        )
      )
    ).toBe(true);
  });

  it.effect(
    "treats no cursor as the first page and refuses an unreadable one",
    () =>
      Effect.gen(function* () {
        expect(yield* decodeCursorOrFail(undefined)).toBeNull();
        expect(yield* decodeCursorOrFail("")).toBeNull();

        const cursor = cursorAt("2026-08-11T12:30:00.000Z");
        expect(yield* decodeCursorOrFail(encodeCursor(cursor))).toEqual(cursor);

        // Ignoring an unreadable cursor would silently return the first page
        // forever, so it is the published refusal instead.
        const result = yield* Effect.result(decodeCursorOrFail("not-a-cursor"));
        expect(Result.isFailure(result)).toBe(true);
        if (Result.isFailure(result)) {
          expect(result.failure._tag).toBe("INVALID_REQUEST");
        }
      })
  );
});
