import {
  getReservedSubdomains,
  isValidSubdomainLabel,
} from "@feeblo/utils/url";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import leo from "leo-profanity";

import { ProfanityConfig } from "./config";
import {
  InvalidSubdomainError,
  ProfanityError,
  ReservedSubdomainError,
} from "./errors";

export type SubdomainValidationResult = {
  readonly valid: true;
  readonly message: string;
};

export type SubdomainValidationError =
  | InvalidSubdomainError
  | ProfanityError
  | ReservedSubdomainError;

const validResult: SubdomainValidationResult = {
  valid: true,
  message: "Subdomain is valid",
};

const invalidError = (subdomain: string) =>
  new InvalidSubdomainError({
    message: `"${subdomain}" is not a valid subdomain. Use lowercase letters, numbers, and hyphens.`,
  });

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
      const reservedSubdomainsEnv = yield* Config.String(
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

        // Before reserved and profanity: a value that is not a DNS label is
        // rejected on its own terms, and it is the value that would be
        // interpolated into a hostname if it were stored.
        if (!isValidSubdomainLabel(normalized)) {
          return Effect.fail(invalidError(subdomain));
        }

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
