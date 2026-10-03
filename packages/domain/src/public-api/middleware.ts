import {
  hasPublicApiScope,
  type PublicApiScope,
} from "@feeblo/domain-contracts/public-api-scope";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { HttpApiSchemaError } from "effect/http-api/HttpApiError";
import * as HttpApiMiddleware from "effect/http-api/HttpApiMiddleware";
import * as HttpApiSecurity from "effect/http-api/HttpApiSecurity";
import * as OpenApi from "effect/http-api/OpenApi";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import { Auth } from "../auth-handler";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import {
  authenticatePublicApiKey,
  type PublicApiCall,
  publicApiRateLimitHeaders,
} from "./api-key-auth";
import {
  forbiddenScopeError,
  invalidRequestError,
  InvalidRequestError,
  PUBLIC_API_MIDDLEWARE_ERROR_SCHEMAS,
} from "./errors";

/** The header a caller presents its key in. */
export const PUBLIC_API_KEY_HEADER = "x-api-key";

/**
 * The credential location of the Public API, as the document declares it.
 *
 * Declared on the key middleware rather than hand-annotated into the document:
 * `OpenApi.fromApi` reads the `security` record of every group's middleware to
 * emit `components.securitySchemes` and a requirement on each operation, which
 * is what the published reference reads to show the Authorize button and the
 * lock on every operation. Declaring it here keeps the header name one value —
 * the middleware reads the credential the framework decodes with the same
 * declaration — so a renamed header cannot drift between the two.
 */
export const PublicApiKeySecurity = HttpApiSecurity.apiKey({
  key: PUBLIC_API_KEY_HEADER,
  in: "header",
}).pipe(
  HttpApiSecurity.annotate(
    OpenApi.Description,
    "A workspace API key, presented in the x-api-key header."
  )
);

/**
 * Per-key request budget. Documented in `docs/public-api.md`, so changing it is
 * customer-visible; increases may ship quietly, decreases are announced.
 */
export const PUBLIC_API_KEY_RATE_LIMIT = {
  limit: 300,
  window: "1 minute",
} as const satisfies { limit: number; window: Duration.Input };

export class PublicApiCaller extends Context.Service<
  PublicApiCaller,
  PublicApiCall
>()("@feeblo/domain/PublicApi/PublicApiCaller") {}

export class ApiKeyAuthMiddleware extends HttpApiMiddleware.Service<
  ApiKeyAuthMiddleware,
  { provides: PublicApiCaller }
>()("@feeblo/domain/PublicApi/ApiKeyAuthMiddleware", {
  error: PUBLIC_API_MIDDLEWARE_ERROR_SCHEMAS,
  // The schema above documents which failures the middleware answers with;
  // this declaration is what names the credential in the document so a
  // generated client can send it and the reference can offer to Authorize.
  security: { apiKey: PublicApiKeySecurity },
}) {}

/**
 * Endpoint-level scope gate.
 *
 * Scopes are checked per endpoint rather than inferred from the path, so that
 * adding an endpoint forces a decision about which scope it needs, and a key
 * created before a scope existed can never gain it by accident.
 */
export const requirePublicApiScope = (scope: PublicApiScope) =>
  Effect.gen(function* () {
    const caller = yield* currentPublicApiCaller;
    if (!hasPublicApiScope(caller.scopes, scope)) {
      return yield* forbiddenScopeError(scope);
    }
  });

/**
 * Reads the caller from the fiber context.
 *
 * `HttpApiBuilder` does not thread group-middleware services through a
 * handler's type-level requirements, so this mirrors `currentHttpApiSession`:
 * the middleware has already provided the value by the time a handler runs.
 */
export const currentPublicApiCaller = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiCaller))
);

/**
 * Builds the key middleware for one composition.
 *
 * The limit is a parameter so a test can exhaust it without issuing three
 * hundred requests; production passes `PUBLIC_API_KEY_RATE_LIMIT`.
 *
 * The implementation is the middleware's own security form: because the class
 * declares `PublicApiKeySecurity`, `of` takes one handler per declared scheme
 * and the framework decodes the credential from the request before calling it —
 * so a missing header arrives as an empty string and still fails here, with
 * `MISSING_API_KEY`, rather than being skipped.
 *
 * The check itself is `authenticatePublicApiKey`, shared with the `/mcp`
 * route's key gate: this layer only resolves the services once and hands them
 * to it, because an `HttpApiMiddleware` implementation may not take request-
 * time requirements of its own.
 */
export const makeApiKeyAuthMiddlewareLive = (
  options: {
    readonly limit: number;
    readonly window: Duration.Input;
  } = PUBLIC_API_KEY_RATE_LIMIT
) =>
  Layer.effect(
    ApiKeyAuthMiddleware,
    Effect.gen(function* () {
      const auth = yield* Auth;
      const entitlementPolicy = yield* EntitlementPolicy;
      const rateLimitService = yield* RateLimitService;

      return ApiKeyAuthMiddleware.of({
        apiKey: (effect, { credential }) =>
          Effect.gen(function* () {
            // The framework reads the raw header, so trim here: a padded value
            // still verifies and whitespace alone is still "no key".
            const presented = Redacted.value(credential).trim();

            const call = yield* authenticatePublicApiKey(
              presented,
              options
            ).pipe(
              Effect.provideService(Auth, auth),
              Effect.provideService(EntitlementPolicy, entitlementPolicy),
              Effect.provideService(RateLimitService, rateLimitService)
            );

            // The effect is the endpoint this middleware wraps; give it the
            // caller now that the key is verified and paid for, and describe
            // the budget that request spent on the response it produced.
            // `X-RateLimit-Reset` is derived from the clock at response time,
            // not at consume time, so a slow handler still reports a reset
            // instant that is still ahead of the caller.
            const now = yield* Clock.currentTimeMillis;
            const headers = publicApiRateLimitHeaders(call.rateLimit, now);
            return yield* effect.pipe(
              Effect.provideService(PublicApiCaller, call),
              Effect.map((response) =>
                HttpServerResponse.setHeaders(response, headers)
              )
            );
          }),
      });
    })
  );

/** The middleware as production composes it. */
export const ApiKeyAuthMiddlewareLive = makeApiKeyAuthMiddlewareLive();

/**
 * The middleware that answers a request the framework could not decode.
 *
 * `HttpApiBuilder` decodes params, query, headers, and payload before a handler
 * runs, and a decode failure is a typed `HttpApiSchemaError` which the builder
 * turns into a defect — an unhandled route error, not this API's envelope. A
 * malformed body is the caller's mistake and has to be reported as one; doing
 * it in a middleware means it is reported the same way for every endpoint
 * rather than by re-declaring a schema on each.
 *
 * A service of its own rather than a branch inside the key middleware, because
 * the framework hands this job to `layerSchemaErrorTransform` and because this
 * one provides nothing and must run *inside* authentication: a request with no
 * key is a 401, and its body is never decoded.
 *
 * Declares `INVALID_REQUEST`, which every endpoint already publishes, so the
 * document gains no status from it.
 */
export class PublicApiSchemaErrorHandler extends HttpApiMiddleware.Service<PublicApiSchemaErrorHandler>()(
  "@feeblo/domain/PublicApi/PublicApiSchemaErrorHandler",
  {
    error: InvalidRequestError,
  }
) {}

/**
 * The message for a request the endpoint's schema rejected.
 *
 * Per kind rather than one string, so a caller can tell a body it sent wrong
 * from a query it built wrong. Fixed strings: the schema error carries the
 * offending field path and the value's type, and echoing a caller's own input
 * back in an error body is a reflection the contract does not need.
 */
const requestSchemaErrorMessage = (
  error: HttpApiSchemaError
): string | undefined => {
  switch (error.kind) {
    case "Headers":
      return "The request headers are not valid for this endpoint.";
    case "Params":
      return "The request path parameters are not valid for this endpoint.";
    case "Payload":
      return "The request body is not valid for this endpoint.";
    case "Query":
      return "The request query parameters are not valid for this endpoint.";
    default:
      // `Body` and `ResponseHeaders` wrap response *encoding*. A response this
      // API cannot encode is a server defect, not the caller's mistake, so it
      // is re-failed and stays the 500 the framework already made it.
      return undefined;
  }
};

/** The schema-error handler as production composes it. */
export const PublicApiSchemaErrorHandlerLive =
  HttpApiMiddleware.layerSchemaErrorTransform(
    PublicApiSchemaErrorHandler,
    (error) => {
      const message = requestSchemaErrorMessage(error);
      return message === undefined
        ? Effect.fail(error)
        : Effect.fail(invalidRequestError(message));
    }
  );
