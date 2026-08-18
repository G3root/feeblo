import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ProfanityConfig } from "./config";
import { ProfanityError, ReservedSubdomainError } from "./errors";
import { SubdomainValidationService } from "./service";

type ConfigOverrides = {
  readonly extraWords?: string[];
};

const testLayer = (overrides: ConfigOverrides = {}) =>
  SubdomainValidationService.layer.pipe(
    Layer.provide(
      Layer.effect(
        ProfanityConfig,
        Effect.succeed({
          extraWords: overrides.extraWords ?? [],
        })
      )
    )
  );

const validate = (subdomain: string, overrides?: ConfigOverrides) =>
  Effect.gen(function* () {
    const { validate } = yield* SubdomainValidationService;
    return yield* validate(subdomain);
  }).pipe(Effect.provide(testLayer(overrides)));

describe("SubdomainValidationService", () => {
  it.effect("accepts clean subdomains using the bundled dictionary", () =>
    Effect.gen(function* () {
      const result = yield* validate("my-awesome-workspace");
      expect(result).toEqual({ valid: true, message: "Subdomain is valid" });
    })
  );

  it.effect("accepts subdomains that merely contain bad substrings", () =>
    Effect.gen(function* () {
      for (const slug of ["class", "cocktail", "scunthorpe", "analysis"]) {
        const result = yield* validate(slug);
        expect(result.valid, slug).toBe(true);
      }
    })
  );

  it.effect("rejects reserved subdomains", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(validate("app"));
      expect(error).toBeInstanceOf(ReservedSubdomainError);
      expect(error.message).toContain("reserved");
    })
  );

  it.effect(
    "rejects subdomains containing profanity, including hyphenated slugs",
    () =>
      Effect.gen(function* () {
        for (const slug of ["fuck", "shit-app", "my-asshole-workspace"]) {
          const error = yield* Effect.flip(validate(slug));
          expect(error, slug).toBeInstanceOf(ProfanityError);
        }
      })
  );

  it.effect("rejects profanity case-insensitively", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(validate("FUCK"));
      expect(error).toBeInstanceOf(ProfanityError);
    })
  );

  it.effect("reports which words matched in the error message", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(validate("fuck-app"));
      expect(error.message).toContain("fuck");
    })
  );

  it.effect("appends extra words to the bundled dictionary", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        validate("snarf-app", {
          extraWords: ["snarf"],
        })
      );
      expect(error).toBeInstanceOf(ProfanityError);
      expect(error.message).toContain("snarf");

      // Bundled words are still flagged.
      const bundledError = yield* Effect.flip(
        validate("fuck", {
          extraWords: ["snarf"],
        })
      );
      expect(bundledError).toBeInstanceOf(ProfanityError);
    })
  );

  it.effect("matches configured words as exact tokens", () =>
    Effect.gen(function* () {
      // A configured word matches only as a whole slug token.
      const error = yield* Effect.flip(
        validate("snarf-app", {
          extraWords: ["snarf"],
        })
      );
      expect(error).toBeInstanceOf(ProfanityError);
      expect(error.message).toContain("snarf");

      // No substring matching: "art" doesn't flag "smart".
      const substringResult = yield* validate("smart", { extraWords: ["art"] });
      expect(substringResult.valid).toBe(true);
    })
  );

  it.effect("rejects explicitly configured compound words intact", () =>
    Effect.gen(function* () {
      // A configured compound like "foo-bar" is stored intact and matched
      // against the whole slug, so the prohibited compound is rejected.
      const error = yield* Effect.flip(
        validate("foo-bar", {
          extraWords: ["foo-bar"],
        })
      );
      expect(error).toBeInstanceOf(ProfanityError);
      expect(error.message).toContain("foo-bar");

      // Whole-slug matching is exact: a slug that merely contains the
      // compound (but isn't equal to it) is not flagged by it.
      const containedResult = yield* validate("prefix-foo-bar-suffix", {
        extraWords: ["foo-bar"],
      });
      expect(containedResult.valid).toBe(true);
    })
  );

  it.effect("rejects reserved subdomains case-insensitively", () =>
    Effect.gen(function* () {
      for (const slug of ["APP", "Dashboard", "Www"]) {
        const error = yield* Effect.flip(validate(slug));
        expect(error, slug).toBeInstanceOf(ReservedSubdomainError);
        expect(error.message, slug).toContain("reserved");
      }
    })
  );
});
