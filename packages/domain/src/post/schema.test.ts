import { describe, expect, it } from "@effect/vitest";
import { BoardId, PostId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

import { EtaQuarter, PostDelete } from "./schema";

describe("PostDelete", () => {
  it.effect("rejects an empty id array", () =>
    Effect.gen(function* () {
      const boardId = yield* BoardId.generate;
      const organizationId = yield* WorkspaceId.generate;

      // An empty bulk delete used to pass the creator policies vacuously
      // (`posts.length === ids.length`); the request must be unrepresentable.
      expect(S.is(PostDelete)({ id: [], boardId, organizationId })).toBe(false);
    })
  );

  it.effect("accepts a single id and a non-empty batch", () =>
    Effect.gen(function* () {
      const boardId = yield* BoardId.generate;
      const organizationId = yield* WorkspaceId.generate;
      const first = yield* PostId.generate;
      const second = yield* PostId.generate;

      expect(S.is(PostDelete)({ id: first, boardId, organizationId })).toBe(
        true
      );
      expect(
        S.is(PostDelete)({
          id: [first, second],
          boardId,
          organizationId,
        })
      ).toBe(true);
    })
  );
});

describe("EtaQuarter", () => {
  it("accepts the persisted quarter format", () => {
    expect(S.decodeUnknownSync(EtaQuarter)("2026-Q3")).toBe("2026-Q3");
  });

  it.each(["2026-Q0", "2026-Q5", "26-Q3", "2026-q3", "2026-Q3-extra"])(
    "rejects malformed value %s",
    (value) => {
      expect(() => S.decodeUnknownSync(EtaQuarter)(value)).toThrow(
        /^Expected a string matching the RegExp/
      );
    }
  );
});
