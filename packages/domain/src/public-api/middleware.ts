import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpApiMiddleware from "effect/unstable/httpapi/HttpApiMiddleware";

import { Auth } from "../auth-handler";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import { withRemapDbErrors } from "../rpc-errors";
import {
  forbiddenScopeError,
  internalError,
  invalidApiKeyError,
  missingApiKeyError,
  planRequiresUpgradeError,
  PUBLIC_API_ERROR_SCHEMAS,
  rateLimitedError,
  serviceUnavailableError,
} from "./errors";
import {
  hasPublicApiScope,
  type PublicApiScope,
  type PublicApiScopeStatements,
} from "./scopes";

/** The header a caller presents its key in. */
export const PUBLIC_API_KEY_HEADER = "x-api-key";

/**
 * Per-key request budget. Documented in `docs/public-api.md`, so changing it is
 * customer-visible; increases may ship quietly, decreases are announced.
 */
export const PUBLIC_API_KEY_RATE_LIMIT = {
  limit: 300,
  window: "1 minute",
} as const satisfies { limit: number; window: Duration.Input };

/**
 * The identity behind a request: the workspace the key belongs to, the key
 * itself, and the scopes it carries.
 *
 * Deliberately not a `CurrentSession`: a machine credential must not become a
 * member session, so nothing downstream of this middleware can reach session
 * semantics, memberships, or the dashboard policies that depend on them.
 */
export type PublicApiCall = {
  readonly keyId: string;
  readonly organizationId: string;
  readonly scopes: PublicApiScopeStatements | null;
};

export class PublicApiCaller extends Context.Service<
  PublicApiCaller,
  PublicApiCall
>()("@feeblo/domain/PublicApi/PublicApiCaller") {}

export class ApiKeyAuthMiddleware extends HttpApiMiddleware.Service<
  ApiKeyAuthMiddleware,
  { provides: PublicApiCaller }
>()("@feeblo/domain/PublicApi/ApiKeyAuthMiddleware", {
  error: PUBLIC_API_ERROR_SCHEMAS,
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
      return yield* Effect.fail(forbiddenScopeError(scope));
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

const retryAfterSeconds = (
  retryAfter: Duration.Duration | undefined
): number =>
  retryAfter === undefined
    ? 1
    : Math.max(1, Math.ceil(Duration.toSeconds(retryAfter)));

/**
 * Builds the key middleware for one composition.
 *
 * The limit is a parameter so a test can exhaust it without issuing three
 * hundred requests; production passes `PUBLIC_API_KEY_RATE_LIMIT`.
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

      return ApiKeyAuthMiddleware.of((effect) =>
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;

          const presented = Option.getOrUndefined(
            Headers.get(request.headers, PUBLIC_API_KEY_HEADER)
          )?.trim();

          if (presented === undefined || presented.length === 0) {
            return yield* Effect.fail(missingApiKeyError());
          }

          // Server-side verification: the plugin's verifier is a server-only
          // endpoint, so a bearer key cannot be validated by reaching it over
          // HTTP, and it checks `enabled`, expiry, and the stored hash.
          // Verification failures can carry library or database detail, so the
          // cause is logged server-side and the public body stays fixed.
          const verified = yield* Effect.promise(() =>
            auth.api.verifyApiKey({ body: { key: presented } })
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logError("API key verification failed", cause).pipe(
                Effect.andThen(Effect.fail(internalError()))
              )
            )
          );

          const record = verified.valid ? verified.key : null;
          if (record === null) {
            return yield* Effect.fail(invalidApiKeyError());
          }

          const organizationId = record.referenceId;

          // Plan gate on every request, not only at key creation: a workspace
          // that downgraded must stop being served, and the distinct code tells
          // the caller's logs the difference between "bad key" and "billing".
          yield* entitlementPolicy.canUsePublicApi(organizationId).pipe(
            Effect.catchTag("PolicyDenied", () =>
              Effect.fail(planRequiresUpgradeError())
            ),
            // The plan lookup reads the database; a driver failure here is a
            // server problem, not a plan problem.
            withRemapDbErrors("PublicApiPlan", "select"),
            Effect.catchTag("InternalServerError", () =>
              Effect.fail(internalError("The request could not be completed."))
            )
          );

          // Per key rather than per IP: a customer behind a shared NAT is not
          // throttled by neighbours, and a leaked key cannot escape its budget by
          // rotating source addresses.
          yield* rateLimitService
            .consume({
              key: `public-api:key:${record.id}`,
              limit: options.limit,
              window: options.window,
            })
            .pipe(
              Effect.catchTag("RateLimiterError", (error) =>
                Effect.fail(
                  error.reason._tag === "RateLimitExceeded"
                    ? rateLimitedError(
                        retryAfterSeconds(error.reason.retryAfter)
                      )
                    : // Fail closed: admitting unlimited traffic because the
                      // limiter is down would make an outage an abuse window.
                      serviceUnavailableError()
                )
              )
            );

          return yield* effect.pipe(
            Effect.provideService(PublicApiCaller, {
              keyId: record.id,
              organizationId,
              scopes: record.permissions ?? null,
            })
          );
        })
      );
    })
  );

/** The middleware as production composes it. */
export const ApiKeyAuthMiddlewareLive = makeApiKeyAuthMiddlewareLive();
