import * as Effect from "effect/Effect";
import * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Option from "effect/Option";

import {
  DataImportProviderCredentialError,
  type DataImportProviderError,
  DataImportProviderRateLimitedError,
  DataImportProviderResponseError,
  DataImportProviderUnavailableError,
} from "../errors";
import type { TDataImportProviderId } from "../provider-schema";

/** The display name each adapter uses in the sentences a form shows. */
export const PROVIDER_LABELS = {
  canny: "Canny",
  nolt: "Nolt",
  productboard: "Productboard",
} satisfies Record<TDataImportProviderId, string>;

/**
 * `Retry-After` as whole seconds, when the provider sent a usable one.
 *
 * A date-form value is deliberately ignored: the adapters report a wait the
 * form can say in a sentence, and a clock-dependent parse is not worth it for
 * an error a person will re-read in a minute.
 */
export const retryAfterSeconds = (
  response: HttpClientResponse.HttpClientResponse
): number | null =>
  Option.match(Headers.get(response.headers, "retry-after"), {
    onNone: () => null,
    onSome: (value) => {
      const seconds = Number.parseInt(value.trim(), 10);

      return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
    },
  });

const rateLimitMessage = (label: string, seconds: number | null): string => {
  if (seconds === null) {
    return `${label} is rate limiting this credential. Wait a few minutes, then start the import again.`;
  }

  const wait =
    seconds < 60
      ? `${seconds} second${seconds === 1 ? "" : "s"}`
      : `${Math.ceil(seconds / 60)} minute${seconds <= 60 ? "" : "s"}`;

  return `${label} is rate limiting this credential. Try again in about ${wait}.`;
};

/**
 * Executes one provider request and turns every transport or status failure
 * into the provider vocabulary the credential form renders.
 *
 * A 2xx is returned untouched so the adapter can choose its decoder; anything
 * else is a failure this boundary can describe truthfully. The response body
 * is never copied into a message: a provider error page is not a sentence the
 * person pasting a key can act on, and it may contain the key itself.
 */
export const executeProviderRequest = ({
  label,
  provider,
  request,
}: {
  readonly label: string;
  readonly provider: TDataImportProviderId;
  readonly request: HttpClientRequest.HttpClientRequest;
}): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  DataImportProviderError,
  HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const response = yield* HttpClient.execute(request).pipe(
      Effect.mapError(
        (_error) =>
          new DataImportProviderUnavailableError({
            // The transport error is never carried into the typed error: a
            // URL, a request body or a header may contain the credential,
            // and this error is serialized back to the browser.
            cause: new Error(`${label} request failed.`),
            message: `${label} could not be reached. Check the connection and try again.`,
            provider,
          })
      )
    );

    if (response.status === 401 || response.status === 403) {
      return yield* new DataImportProviderCredentialError({
        message: `${label} rejected the credential. Check it and try again.`,
        provider,
      });
    }

    if (response.status === 404) {
      return yield* new DataImportProviderResponseError({
        message: `${label} could not find that account. Check the credential and try again.`,
        provider,
      });
    }

    if (response.status === 429) {
      const wait = retryAfterSeconds(response);

      return yield* new DataImportProviderRateLimitedError({
        message: rateLimitMessage(label, wait),
        provider,
        retryAfterSeconds: wait,
      });
    }

    if (response.status >= 500) {
      return yield* new DataImportProviderUnavailableError({
        message: `${label} is having trouble right now. Try again later.`,
        provider,
      });
    }

    if (response.status < 200 || response.status >= 300) {
      return yield* new DataImportProviderResponseError({
        message: `${label} returned an error (${response.status}). Check the credential and try again.`,
        provider,
      });
    }

    return response;
  });
