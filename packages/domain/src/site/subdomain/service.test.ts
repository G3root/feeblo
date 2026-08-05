import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { describe, expect, it } from "vitest";

import { ProfanityConfig } from "./config";
import { ProfanityError, ReservedSubdomainError } from "./errors";
import { SubdomainValidationService } from "./service";

type ConfigOverrides = {
  readonly customWords?: string[];
  readonly extraWords?: string[];
};

const testLayer = (overrides: ConfigOverrides = {}) =>
  SubdomainValidationService.layer.pipe(
    Layer.provide(
      Layer.effect(
        ProfanityConfig,
        Effect.succeed({
          customWords: overrides.customWords ?? [],
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

const validateOrFail = (subdomain: string, overrides?: ConfigOverrides) =>
  Effect.runPromise(Effect.flip(validate(subdomain, overrides)));

describe("SubdomainValidationService", () => {
  it("accepts clean subdomains using the bundled dictionary", async () => {
    const result = await Effect.runPromise(validate("my-awesome-workspace"));
    expect(result).toEqual({ valid: true, message: "Subdomain is valid" });
  });

  it("accepts subdomains that merely contain bad substrings", async () => {
    for (const slug of ["class", "cocktail", "scunthorpe", "analysis"]) {
      const result = await Effect.runPromise(validate(slug));
      expect(result.valid, slug).toBe(true);
    }
  });

  it("rejects reserved subdomains", async () => {
    const error = await validateOrFail("app");
    expect(error).toBeInstanceOf(ReservedSubdomainError);
    expect(error.message).toContain("reserved");
  });

  it("rejects subdomains containing profanity, including hyphenated slugs", async () => {
    for (const slug of ["fuck", "shit-app", "my-asshole-workspace"]) {
      const error = await validateOrFail(slug);
      expect(error, slug).toBeInstanceOf(ProfanityError);
    }
  });

  it("rejects profanity case-insensitively", async () => {
    const error = await validateOrFail("FUCK");
    expect(error).toBeInstanceOf(ProfanityError);
  });

  it("reports which words matched in the error message", async () => {
    const error = await validateOrFail("fuck-app");
    expect(error.message).toContain("fuck");
  });

  it("uses custom words instead of the bundled dictionary", async () => {
    const error = await validateOrFail("zorp", {
      customWords: ["zorp", "wibble"],
    });
    expect(error).toBeInstanceOf(ProfanityError);
    expect(error.message).toContain("zorp");

    // The bundled dictionary is replaced, so "fuck" is no longer flagged.
    const result = await Effect.runPromise(
      validate("fuck", { customWords: ["zorp", "wibble"] })
    );
    expect(result.valid).toBe(true);
  });

  it("appends extra words to the bundled dictionary", async () => {
    const error = await validateOrFail("snarf-app", {
      extraWords: ["snarf"],
    });
    expect(error).toBeInstanceOf(ProfanityError);
    expect(error.message).toContain("snarf");

    // Bundled words are still flagged.
    const bundledError = await validateOrFail("fuck", {
      extraWords: ["snarf"],
    });
    expect(bundledError).toBeInstanceOf(ProfanityError);
  });
});
