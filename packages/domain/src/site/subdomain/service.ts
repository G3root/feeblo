import { getReservedSubdomains } from "@feeblo/utils/url";
import * as Config from "effect/Config";
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

const TOKEN_REGEX = /[^a-z]+/;

export class SubdomainValidationService extends Context.Service<SubdomainValidationService>()(
  "SubdomainValidationService",
  {
    make: Effect.gen(function* () {
      const { extraWords } = yield* ProfanityConfig;
      const reservedSubdomainsEnv = yield* Config.string(
        "RESERVED_SUBDOMAINS"
      ).pipe(Config.withDefault(""));
      const reservedSubdomains = getReservedSubdomains(reservedSubdomainsEnv);

      const extraTokenSet = new Set(extraWords);

      const validate = Effect.fn("SubdomainValidationService.validate")((
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

        const matches: string[] = [];

        // Configured compounds (e.g. "foo-bar") are stored intact, so match
        // the whole slug before tokenizing — otherwise tokenization splits
        // the slug into pieces that never equal the prohibited compound.
        if (extraTokenSet.has(normalized)) {
          matches.push(normalized);
        } else {
          const tokens = normalized.split(TOKEN_REGEX).filter(Boolean);
          for (const token of tokens) {
            if (leo.check(token) || extraTokenSet.has(token)) {
              matches.push(token);
            }
          }
        }

        if (matches.length > 0) {
          return Effect.fail(profanityError(matches));
        }

        return Effect.succeed(validResult);
      });

      return { validate } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);

  /** Self-contained layer driven by environment variables. */
  static readonly layerEnv = this.layer.pipe(
    Layer.provide(ProfanityConfig.layer)
  );
}
