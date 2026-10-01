import type { PublicApiScopeStatements } from "@feeblo/domain-contracts/public-api-scope";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import { Auth } from "../auth-handler";
import { EntitlementPolicy } from "../entitlement/policies";
import { RateLimitService } from "../rate-limit/service";
import { withRemapDbErrors } from "../rpc-errors";
import {
  internalError,
  invalidApiKeyError,
  missingApiKeyError,
  planRequiresUpgradeError,
  rateLimitedError,
  serviceUnavailableError,
} from "./errors";

/**
 * The identity behind a request: the workspace the key belongs to, the key
 * itself, and the scopes it carries.
 *
 * Deliberately not a `CurrentSession`: a machine credential must not become a
 * member session, so nothing downstream of this resolution can reach session
 * semantics, memberships, or the dashboard policies that depend on them.
 */
export type PublicApiCall = {
  readonly keyId: string;
  readonly organizationId: string;
  readonly scopes: PublicApiScopeStatements | null;
};

/** The per-key request budget a caller's key is spent against. */
export type PublicApiKeyBudget = {
  readonly limit: number;
  readonly window: Duration.Input;
};

const retryAfterSeconds = (
  retryAfter: Duration.Duration | undefined
): number =>
  retryAfter === undefined
    ? 1
    : Math.max(1, Math.ceil(Duration.toSeconds(retryAfter)));

/**
 * Turns a presented API key into the call it authenticates.
 *
 * This is the whole of the key check — presence, server-side verification, the
 * per-key rate limit, and the plan gate — and it is deliberately not shaped as
 * an HTTP API middleware. Every surface that is paid-only by key (the `/api/v1`
 * HTTP endpoints and the `/mcp` JSON-RPC endpoint) resolves its caller through
 * this one function, so a fix to the verification, the budget, or the plan gate
 * cannot reach one surface and miss the other.
 *
 * The caller it returns is the value a surface provides to its handlers; a
 * machine credential never resolves into a member session.
 */
export const authenticatePublicApiKey = (
  presented: string,
  budget: PublicApiKeyBudget
) =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const entitlementPolicy = yield* EntitlementPolicy;
    const rateLimitService = yield* RateLimitService;

    // The caller trims at the surface boundary; a padded value still verifies
    // and whitespace alone is still "no key".
    if (presented.length === 0) {
      return yield* missingApiKeyError();
    }

    // Server-side verification: the plugin's verifier is a server-only
    // endpoint, so a bearer key cannot be validated by reaching it over HTTP,
    // and it checks `enabled`, expiry, and the stored hash. Verification
    // failures can carry library or database detail, so the cause is logged
    // server-side and the public body stays fixed.
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
      return yield* invalidApiKeyError();
    }

    const organizationId = record.referenceId;

    // Per key rather than per IP: a customer behind a shared NAT is not
    // throttled by neighbours, and a leaked key cannot escape its budget by
    // rotating source addresses.
    //
    // Runs before the plan gate: the gate reads the database, so a verified
    // key must spend budget before it can trigger that lookup, including a
    // downgraded key that the gate will then reject.
    yield* rateLimitService
      .consume({
        key: `public-api:key:${record.id}`,
        limit: budget.limit,
        window: budget.window,
      })
      .pipe(
        Effect.catchTag("RateLimiterError", (error) =>
          Effect.fail(
            error.reason._tag === "RateLimitExceeded"
              ? rateLimitedError(retryAfterSeconds(error.reason.retryAfter))
              : // Fail closed: admitting unlimited traffic because the limiter
                // is down would make an outage an abuse window.
                serviceUnavailableError()
          )
        )
      );

    // Plan gate on every request, not only at key creation: a workspace that
    // downgraded must stop being served, and the distinct code tells the
    // caller's logs the difference between "bad key" and "billing".
    yield* entitlementPolicy.canUsePublicApi(organizationId).pipe(
      Effect.catchTag("PolicyDenied", () =>
        Effect.fail(planRequiresUpgradeError())
      ),
      // The plan lookup reads the database; a driver failure here is a server
      // problem, not a plan problem.
      withRemapDbErrors("PublicApiPlan", "select"),
      Effect.catchTag("InternalServerError", () =>
        Effect.fail(internalError("The request could not be completed."))
      )
    );

    return {
      keyId: record.id,
      organizationId,
      scopes: record.permissions ?? null,
    };
  });

/** Every failure a surface's key resolution can answer with. */
export type PublicApiAuthenticationFailure = Effect.Error<
  ReturnType<typeof authenticatePublicApiKey>
>;
