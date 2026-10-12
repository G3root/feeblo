import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ProfanityConfig } from "./config";
import {
  InvalidSubdomainError,
  ProfanityError,
  ReservedSubdomainError,
} from "./errors";
import { SubdomainValidationService } from "./service";

type ConfigOverrides = {
  readonly extraWords?: string[];
};

const validate = (subdomain: string, overrides?: ConfigOverrides) =>
  Effect.gen(function* () {
    const service = yield* SubdomainValidationService.make;
    return yield* service.validate(subdomain);
  }).pipe(
    Effect.provideService(ProfanityConfig, {
      extraWords: overrides?.extraWords ?? [],
    })
  );

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
        expect(result.valid).toBe(true);
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

  it.effect("rejects subdomains that are not single DNS labels", () =>
    Effect.gen(function* () {
      // `slugify` preserves every character these cases rely on, so each one
      // can reach storage and would then be interpolated into a hostname:
      // `evil@victim` parses as `victim.<root>` (userinfo confusion), and a
      // dot produces an extra label.
      for (const slug of [
        "evil@victim",
        "acme.corp",
        "under_score",
        "colon:port",
        "star*label",
        "leading-",
        "-trailing",
        "has space",
        "a".repeat(64),
      ]) {
        const error = yield* Effect.flip(validate(slug));
        expect(error).toBeInstanceOf(InvalidSubdomainError);
      }
    })
  );

  it.effect("accepts every valid DNS label shape", () =>
    Effect.gen(function* () {
      for (const slug of ["a", "ab", "my-awesome-workspace", "a".repeat(63)]) {
        const result = yield* validate(slug);
        expect(result.valid).toBe(true);
      }
    })
  );

  it.effect(
    "rejects subdomains containing profanity, including hyphenated slugs",
    () =>
      Effect.gen(function* () {
        for (const slug of ["fuck", "shit-app", "my-asshole-workspace"]) {
          const error = yield* Effect.flip(validate(slug));
          expect(error).toBeInstanceOf(ProfanityError);
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
        expect(error).toBeInstanceOf(ReservedSubdomainError);
        expect(error.message).toContain("reserved");
      }
    })
  );
});
