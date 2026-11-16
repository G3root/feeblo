import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { normalizeArticleWrite } from "./write";

const now = new Date("2026-01-01T00:00:00.000Z");
const earlier = new Date("2025-06-01T00:00:00.000Z");
const explicit = new Date("2025-09-09T00:00:00.000Z");

const write = (overrides: {
  content?: string;
  previousPublishedAt?: Date | null;
  requestedPublishedAt?: Date | null;
  slug?: string;
  status?: "draft" | "published" | "archived";
  title?: string;
}) =>
  normalizeArticleWrite({
    content: overrides.content ?? "Hello",
    now,
    previousPublishedAt: overrides.previousPublishedAt ?? null,
    requestedPublishedAt: overrides.requestedPublishedAt ?? null,
    slug: overrides.slug,
    status: overrides.status ?? "draft",
    title: overrides.title ?? "Getting started",
  });

describe("normalizeArticleWrite", () => {
  it.effect("derives the slug from the title when none is supplied", () =>
    Effect.gen(function* () {
      const result = yield* write({ title: "  How do I reset my password?  " });

      expect(result.title).toBe("How do I reset my password?");
      expect(result.slug).toBe("how-do-i-reset-my-password");
    })
  );

  it.effect(
    "normalizes a supplied slug so two spellings cannot become two pages",
    () =>
      Effect.gen(function* () {
        const result = yield* write({ slug: "UI Kit" });

        expect(result.slug).toBe("ui-kit");
      })
  );

  it.effect("refuses a title that is only whitespace", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(write({ title: "   " }));

      expect(error._tag).toBe("BadRequestError");
    })
  );

  it.effect("refuses a slug with nothing sluggable in it", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(write({ title: "!!!", slug: "???" }));

      expect(error._tag).toBe("BadRequestError");
    })
  );

  it.effect("clears the publication date for a draft", () =>
    Effect.gen(function* () {
      // The column's own check says a draft has no publication, so a draft that
      // kept a stale date would be a row the database refuses.
      const result = yield* write({
        previousPublishedAt: earlier,
        requestedPublishedAt: earlier,
        status: "draft",
      });

      expect(result.publishedAt).toBeNull();
    })
  );

  it.effect("stamps a publication date when the caller supplies none", () =>
    Effect.gen(function* () {
      const result = yield* write({ status: "published" });

      expect(result.publishedAt).toEqual(now);
    })
  );

  it.effect("keeps the original publication date on a republish", () =>
    Effect.gen(function* () {
      // A typo fix must not look like a new release to a reader sorting by date.
      const result = yield* write({
        previousPublishedAt: earlier,
        status: "published",
      });

      expect(result.publishedAt).toEqual(earlier);
    })
  );

  it.effect("prefers an explicit date over the stored one", () =>
    Effect.gen(function* () {
      const result = yield* write({
        previousPublishedAt: earlier,
        requestedPublishedAt: explicit,
        status: "published",
      });

      expect(result.publishedAt).toEqual(explicit);
    })
  );

  it.effect("gives an archived article the date it first went live", () =>
    Effect.gen(function* () {
      // `archived` is only reachable from published, so the column requires a
      // date here too — the same rule the database enforces.
      const result = yield* write({
        previousPublishedAt: earlier,
        status: "archived",
      });

      expect(result.publishedAt).toEqual(earlier);
    })
  );

  it.effect(
    "sanitizes the body and derives the excerpt from its rendering",
    () =>
      Effect.gen(function* () {
        const result = yield* write({
          content:
            "# Title\n\nSome **body** text with a [link](https://example.com).",
        });

        expect(result.content).toContain("# Title");
        expect(result.excerpt.length).toBeGreaterThan(0);
        expect(result.excerpt).not.toContain("#");
      })
  );
});
