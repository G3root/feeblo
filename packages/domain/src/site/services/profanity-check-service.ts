import { getReservedSubdomains } from "@feeblo/utils/url";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";

import { ProfanityCheckConfig } from "./profanity-check-config";
import {
  ProfanityCheckResponse,
  ProfanityError,
  ReservedSubdomainError,
  type TProfanityCheckResponse,
} from "./profanity-check-schema";

export type SubdomainValidationResult = TProfanityCheckResponse & {
  readonly valid: true;
};

export type SubdomainValidationError = ProfanityError | ReservedSubdomainError;

const validResult = {
  valid: true as const,
  message: "Subdomain is valid",
};

const reservedError = (subdomain: string) =>
  new ReservedSubdomainError({
    message: `"${subdomain}" is a reserved subdomain`,
  });

const make = Effect.gen(function* () {
  const config = yield* ProfanityCheckConfig;
  const reservedSubdomains = getReservedSubdomains();

  if (Option.isNone(config.apiUrl)) {
    const validate = (
      subdomain: string
    ): Effect.Effect<
      SubdomainValidationResult,
      SubdomainValidationError,
      never
    > => {
      if (reservedSubdomains.includes(subdomain)) {
        return Effect.fail(reservedError(subdomain));
      }
      return Effect.succeed(validResult);
    };
    return { validate } as const;
  }

  const apiUrl = config.apiUrl.value;
  const client = yield* HttpClient.HttpClient;

  const validate = (
    subdomain: string
  ): Effect.Effect<
    SubdomainValidationResult,
    SubdomainValidationError,
    never
  > => {
    if (reservedSubdomains.includes(subdomain)) {
      return Effect.fail(reservedError(subdomain));
    }

    return Effect.gen(function* () {
      const url = new URL(apiUrl);
      url.searchParams.set("subdomain", subdomain);

      const response = yield* client.get(url);
      const body = yield* response.json;
      const result = yield* Schema.decodeUnknownEffect(ProfanityCheckResponse)(
        body
      );

      if (!result.valid) {
        const error =
          result.type === "reserved"
            ? new ReservedSubdomainError({ message: result.message })
            : new ProfanityError({ message: result.message });
        return yield* error;
      }

      return result as SubdomainValidationResult;
    }).pipe(
      Effect.catchTags({
        HttpClientError: () =>
          Effect.fail(
            new ProfanityError({ message: "Failed to validate subdomain" })
          ),
        SchemaError: () =>
          Effect.fail(
            new ProfanityError({ message: "Failed to validate subdomain" })
          ),
      })
    );
  };

  return { validate } as const;
});

export class SubdomainValidationService extends Context.Service<SubdomainValidationService>()(
  "SubdomainValidationService",
  { make: make.pipe(Effect.provide(ProfanityCheckConfig.layer)) }
) {
  static readonly layer = Layer.effect(this, this.make);
  static readonly liveLayer = this.layer.pipe(
    Layer.provide(FetchHttpClient.layer)
  );
}
