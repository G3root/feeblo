import { beforeEach, describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  asLegidArray,
  asLegidArrayById,
  LegidError,
  makeId,
} from "../src/legid";

describe("makeId", () => {
  const factory = makeId("post", "pst", { approximateLength: 12 });

  describe("generate", () => {
    it.effect("generates an id with the visible prefix", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;

        expect(id.startsWith("pst_")).toBe(true);
        expect(id).toMatch(/^pst_[A-Za-z0-9]+$/);
      })
    );

    it.effect("generates unique ids", () =>
      Effect.gen(function* () {
        const ids = yield* Effect.all(
          Array.from({ length: 50 }, () => factory.generate)
        );

        expect(new Set(ids).size).toBe(50);
      })
    );

    it("unsafeGenerate returns a Promise with the prefix", async () => {
      const id = await factory.unsafeGenerate();

      expect(id.startsWith("pst_")).toBe(true);
    });

    it("exposes the prefix on the factory", () => {
      expect(factory.prefix).toBe("pst");
    });
  });

  describe("verify", () => {
    it.effect("verifies a freshly generated id", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;
        const isValid = yield* factory.verify(id);

        expect(isValid).toBe(true);
      })
    );

    it.effect("rejects an id with the wrong prefix", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;
        const wrongPrefix = `cmt_${id.slice(4)}`;
        const isValid = yield* factory.verify(wrongPrefix);

        expect(isValid).toBe(false);
      })
    );

    it.effect("rejects an id without a prefix", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;
        const noPrefix = id.slice(4);
        const isValid = yield* factory.verify(noPrefix);

        expect(isValid).toBe(false);
      })
    );

    it.effect("rejects a tampered id", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;
        const tampered = `${id.slice(0, -1)}0`;
        const isValid = yield* factory.verify(tampered);

        expect(isValid).toBe(false);
      })
    );

    it.effect("rejects a random prefixed string", () =>
      Effect.gen(function* () {
        const isValid = yield* factory.verify("pst_admin");

        expect(isValid).toBe(false);
      })
    );
  });

  describe("parse", () => {
    it.effect("parses a valid id and brands it", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;
        const parsed = yield* factory.parse(id);

        expect(parsed).toBe(id);
      })
    );

    it.effect("fails with LegidError on missing prefix", () =>
      Effect.gen(function* () {
        const result = yield* factory
          .parse("aB3xY9kQ2rMn")
          .pipe(
            Effect.catchTag("LegidError", (error) => Effect.succeed(error))
          );

        expect(result).toBeInstanceOf(LegidError);
        expect((result as LegidError).message).toBe(
          "ID must contain a prefix separator '_'"
        );
      })
    );

    it.effect("fails with LegidError on wrong prefix", () =>
      Effect.gen(function* () {
        const result = yield* factory
          .parse("cmt_aB3xY9kQ2rMn")
          .pipe(
            Effect.catchTag("LegidError", (error) => Effect.succeed(error))
          );

        expect(result).toBeInstanceOf(LegidError);
        expect((result as LegidError).message).toBe('ID prefix must be "pst"');
      })
    );

    it.effect("fails with LegidError on tampered id body", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;
        const tampered = `${id.slice(0, -1)}0`;
        const result = yield* factory
          .parse(tampered)
          .pipe(
            Effect.catchTag("LegidError", (error) => Effect.succeed(error))
          );

        expect(result).toBeInstanceOf(LegidError);
      })
    );

    it.effect("fails with LegidError on empty input", () =>
      Effect.gen(function* () {
        const result = yield* factory
          .parse("")
          .pipe(
            Effect.catchTag("LegidError", (error) => Effect.succeed(error))
          );

        expect(result).toBeInstanceOf(LegidError);
      })
    );

    it("unsafeParse rejects on invalid id", async () => {
      await expect(factory.unsafeParse("admin")).rejects.toBeInstanceOf(
        LegidError
      );
    });
  });

  describe("is", () => {
    it.effect("returns true for a well-formed prefixed id", () =>
      Effect.gen(function* () {
        const id = yield* factory.generate;

        expect(factory.is(id)).toBe(true);
      })
    );

    it("returns false for an id without a prefix", () => {
      expect(factory.is("aB3xY9kQ2rMn")).toBe(false);
    });

    it("returns false for an id with the wrong prefix", () => {
      expect(factory.is("cmt_aB3xY9kQ2rMn")).toBe(false);
    });

    it("returns false for empty input", () => {
      expect(factory.is("")).toBe(false);
    });

    it("returns false for an id with invalid body characters", () => {
      expect(factory.is("pst_invalid_id!")).toBe(false);
    });
  });

  describe("brand", () => {
    it("derives the default brand name from the factory name", () => {
      expect(factory.brand).toBe("PostId");
    });

    it("capitalizes snake_case names into PascalCase brand names", () => {
      const factory = makeId("comment_reaction", "crt");

      expect(factory.brand).toBe("CommentReactionId");
    });
  });

  describe("prefix validation", () => {
    it("throws on a prefix with uppercase letters", () => {
      expect(() => makeId("post", "PST")).toThrow();
    });

    it("throws on a prefix with digits", () => {
      expect(() => makeId("post", "ps1")).toThrow();
    });

    it("throws on an empty prefix", () => {
      expect(() => makeId("post", "")).toThrow();
    });

    it("throws on a prefix with underscores", () => {
      expect(() => makeId("post", "p_s")).toThrow();
    });
  });

  describe("asLegidArray", () => {
    it("returns the same array at runtime", () => {
      const raw = ["pst_aB3xY9kQ2rMn", "pst_bC4zZ0lQ3sNo"];
      const branded = asLegidArray(factory)(raw);

      expect(branded).toBe(raw);
    });
  });

  describe("asLegidArrayById", () => {
    it("returns the same array at runtime and preserves other fields", () => {
      const raw = [
        { id: "pst_aB3xY9kQ2rMn", title: "Hello" },
        { id: "pst_bC4zZ0lQ3sNo", title: "World" },
      ];
      const branded = asLegidArrayById(factory)(raw);

      expect(branded).toBe(raw);
      expect(branded[0]?.title).toBe("Hello");
    });
  });
});

describe("namespacing across factories", () => {
  beforeEach(() => {
    // ensure crypto.randomUUID is stable across tests (no-op, just for clarity)
  });

  it.effect(
    "a prefixed id is not valid for a factory with a different prefix",
    () =>
      Effect.gen(function* () {
        const post = makeId("post", "pst", { approximateLength: 12 });
        const comment = makeId("comment", "cmt", {
          approximateLength: 12,
        });

        const postId = yield* post.generate;
        const commentId = yield* comment.generate;

        expect(post.is(commentId)).toBe(false);
        expect(comment.is(postId)).toBe(false);
      })
  );
});
