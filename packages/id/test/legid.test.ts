import { Effect } from "effect";
import { beforeEach, describe, expect, it } from "vitest";
import { LegidError, makeId } from "../src/legid";

const run = <A>(
  effect: Effect.Effect<A, LegidError>
): Promise<A | LegidError> =>
  Effect.runPromise(
    effect.pipe(Effect.catchTag("LegidError", (error) => Effect.succeed(error)))
  );

describe("makeId", () => {
  const factory = makeId("post", "pst", { approximateLength: 12 });

  describe("generate", () => {
    it("generates an id with the visible prefix", async () => {
      const id = await Effect.runPromise(factory.generate);

      expect(id.startsWith("pst_")).toBe(true);
      expect(id).toMatch(/^pst_[A-Za-z0-9]+$/);
    });

    it("generates unique ids", async () => {
      const ids = await Promise.all(
        Array.from({ length: 50 }, () => Effect.runPromise(factory.generate))
      );

      expect(new Set(ids).size).toBe(50);
    });

    it("unsafeGenerate returns a Promise with the prefix", async () => {
      const id = await factory.unsafeGenerate();

      expect(id.startsWith("pst_")).toBe(true);
    });

    it("exposes the prefix on the factory", () => {
      expect(factory.prefix).toBe("pst");
    });
  });

  describe("verify", () => {
    it("verifies a freshly generated id", async () => {
      const id = await Effect.runPromise(factory.generate);
      const isValid = await Effect.runPromise(factory.verify(id));

      expect(isValid).toBe(true);
    });

    it("rejects an id with the wrong prefix", async () => {
      const id = await Effect.runPromise(factory.generate);
      const wrongPrefix = `cmt_${id.slice(4)}`;
      const isValid = await Effect.runPromise(factory.verify(wrongPrefix));

      expect(isValid).toBe(false);
    });

    it("rejects an id without a prefix", async () => {
      const id = await Effect.runPromise(factory.generate);
      const noPrefix = id.slice(4);
      const isValid = await Effect.runPromise(factory.verify(noPrefix));

      expect(isValid).toBe(false);
    });

    it("rejects a tampered id", async () => {
      const id = await Effect.runPromise(factory.generate);
      const tampered = `${id.slice(0, -1)}0`;
      const isValid = await Effect.runPromise(factory.verify(tampered));

      expect(isValid).toBe(false);
    });

    it("rejects a random prefixed string", async () => {
      const isValid = await Effect.runPromise(factory.verify("pst_admin"));

      expect(isValid).toBe(false);
    });
  });

  describe("parse", () => {
    it("parses a valid id and brands it", async () => {
      const id = await Effect.runPromise(factory.generate);
      const parsed = await Effect.runPromise(factory.parse(id));

      expect(parsed).toBe(id);
    });

    it("fails with LegidError on missing prefix", async () => {
      const result = await run(factory.parse("aB3xY9kQ2rMn"));

      expect(result).toBeInstanceOf(LegidError);
      expect((result as LegidError).message).toBe(
        "ID must contain a prefix separator '_'"
      );
    });

    it("fails with LegidError on wrong prefix", async () => {
      const result = await run(factory.parse("cmt_aB3xY9kQ2rMn"));

      expect(result).toBeInstanceOf(LegidError);
      expect((result as LegidError).message).toBe('ID prefix must be "pst"');
    });

    it("fails with LegidError on tampered id body", async () => {
      const id = await Effect.runPromise(factory.generate);
      const tampered = `${id.slice(0, -1)}0`;
      const result = await run(factory.parse(tampered));

      expect(result).toBeInstanceOf(LegidError);
    });

    it("fails with LegidError on empty input", async () => {
      const result = await run(factory.parse(""));

      expect(result).toBeInstanceOf(LegidError);
    });

    it("unsafeParse rejects on invalid id", async () => {
      await expect(factory.unsafeParse("admin")).rejects.toBeInstanceOf(
        LegidError
      );
    });
  });

  describe("is", () => {
    it("returns true for a well-formed prefixed id", async () => {
      const id = await Effect.runPromise(factory.generate);

      expect(factory.is(id)).toBe(true);
    });

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
});

describe("namespacing across factories", () => {
  beforeEach(() => {
    // ensure crypto.randomUUID is stable across tests (no-op, just for clarity)
  });

  it("a prefixed id is not valid for a factory with a different prefix", async () => {
    const post = makeId("post", "pst", { approximateLength: 12 });
    const comment = makeId("comment", "cmt", {
      approximateLength: 12,
    });

    const postId = await Effect.runPromise(post.generate);
    const commentId = await Effect.runPromise(comment.generate);

    expect(post.is(commentId)).toBe(false);
    expect(comment.is(postId)).toBe(false);
  });

});
