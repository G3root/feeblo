import { getReservedSubdomains } from "@feeblo/utils/url";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import leo from "leo-profanity";

import { ProfanityConfig } from "./config";
import { ProfanityError, ReservedSubdomainError } from "./errors";

export type SubdomainValidationResult = {
  readonly valid: true;
  readonly message: string;
};

export type SubdomainValidationError = ProfanityError | ReservedSubdomainError;

const validResult: SubdomainValidationResult = {
  valid: true,
  message: "Subdomain is valid",
};

const reservedError = (subdomain: string) =>
  new ReservedSubdomainError({
    message: `"${subdomain}" is a reserved subdomain`,
  });

const profanityError = (matches: string[]) =>
  new ProfanityError({
    message: `Subdomain contains profanity: ${matches.join(", ")}`,
  });

export class SubdomainValidationService extends Context.Service<SubdomainValidationService>()(
  "SubdomainValidationService",
  {
    make: Effect.gen(function* () {
      const { extraWords } = yield* ProfanityConfig;
      const reservedSubdomains = getReservedSubdomains();

      // leo-profanity provides the default English dictionary; extra words
      // (PROFANITY_EXTRA_WORDS) are appended to it.
      const profanitySet = new Set([...leo.list(), ...extraWords]);

      // Tokens are matched whole-word after splitting on non-letter separators,
      // so "my-fuck-app" -> ["my", "fuck", "app"] catches hyphenated slugs while
      // "class" / "cocktail" stay valid.
      const validate = Effect.fn("SubdomainValidationService.validate")(
        (
          subdomain: string
        ): Effect.Effect<
          SubdomainValidationResult,
          SubdomainValidationError,
          never
        > => {
          const normalized = subdomain.toLowerCase();

          if (reservedSubdomains.includes(normalized)) {
            return Effect.fail(reservedError(subdomain));
          }

          const matches = normalized
            .split(/[^a-z]+/)
            .filter(Boolean)
            .filter((token) => profanitySet.has(token));

          if (matches.length > 0) {
            return Effect.fail(profanityError(matches));
          }

          return Effect.succeed(validResult);
        }
      );

      return { validate } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Self-contained layer driven by environment variables. */
  static readonly layerEnv = this.layer.pipe(Layer.provide(ProfanityConfig.layer));
}
