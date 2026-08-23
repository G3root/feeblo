import { isNumber } from "@feeblo/utils/runtime-kind";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { UnauthorizedError } from "../rpc-errors";

/**
 * Rejects oversized tokens before jose parses them. `verifyJwt` runs on
 * unauthenticated paths (widget SSO / feedback identity), so a multi-megabyte
 * base64url token must not be base64-decoded and JSON-parsed per request.
 * A 16 KiB cap is far beyond any legitimate org identity-token payload.
 */
const MAX_JWT_LENGTH = 16 * 1024;

/**
 * Clock-skew tolerance in seconds. `exp`/`nbf` checks by jose and the `iat`
 * check below all tolerate this much skew between the caller's clock and
 * Feeblo's. 30s keeps mint-on-demand tokens (5-minute `exp`) comfortably
 * inside the cap while still bounding a clock-skewed issuer.
 */
const CLOCK_SKEW_LEEWAY_SECONDS = 30;

/**
 * Default maximum token lifetime (`exp - iat`). Tokens claiming to live
 * longer are rejected even when the signature is valid: nothing else stops a
 * leaked long-lived token from staying replayable. Workspaces can tighten
 * this per-org via `organization.jwt_max_token_lifetime_minutes` (see
 * docs/widget-sso.md); 24h is the deliberate default because it matches the
 * rotation grace window.
 */
export const DEFAULT_MAX_TOKEN_LIFETIME = Duration.hours(24);

/**
 * Verifies an HS256-signed org JWT and binds it to the organization.
 *
 * The token must carry the workspace id in its `aud` claim. (Widget SSO /
 * feedback identity tokens are minted by the organization's own backend with
 * their jwt-secret.) Requiring `aud` means a token stolen or minted for one
 * organization can never be replayed against another: without it, anyone
 * holding a leaked secret could forge a payload for any org and the signature
 * check alone would accept it.
 *
 * The `exp` claim is **required**: a token without it is rejected after the
 * signature verifies (jose only validates `exp` when present, so the absence
 * is checked here). `exp`/`nbf` are checked by jose with a 30s clock-skew
 * tolerance. `iat` is additionally rejected when it lies more than 30s in the
 * future (a fresh token can never legitimately carry a future `iat`).
 *
 * The total token lifetime (`exp - iat`, or `exp - now` when `iat` is
 * absent) is capped at {@link DEFAULT_MAX_TOKEN_LIFETIME} or the per-org
 * override in `options.maxTokenLifetime`, so `exp = now + 30 days` is
 * rejected even though the signature is valid.
 *
 * `iss` is intentionally NOT verified: there is no per-org expected-issuer
 * configuration yet, so checking it against nothing would be theater. The
 * docs recommend customers set `iss` to their app URL now so it can be
 * promoted to required in a future release without breaking their tokens.
 *
 * Secrets are stored as 64-char hex (32 bytes). Decode hex to raw bytes.
 */
const secretToKey = (secret: string): Uint8Array =>
  new Uint8Array(Buffer.from(secret, "hex"));

export const verifyJwt = (
  token: string,
  secrets: readonly string[],
  expectedOrganizationId: string,
  options: { readonly maxTokenLifetime?: Duration.Duration } = {}
): Effect.Effect<jose.JWTPayload, UnauthorizedError> =>
  Effect.gen(function* () {
    if (token.length > MAX_JWT_LENGTH) {
      return yield* new UnauthorizedError({ message: "Invalid JWT" });
    }

    const maxTokenLifetime =
      options.maxTokenLifetime ?? DEFAULT_MAX_TOKEN_LIFETIME;

    for (const secret of secrets) {
      const key = secretToKey(secret);

      // jwtVerify rejects expired tokens (or tokens with an invalid
      // signature); any failure just moves on to the next candidate secret
      // (active first, then the 24h-grace revoked one). `clockTolerance`
      // gives both sides a 30s clock-skew allowance.
      const result = yield* Effect.catch(
        Effect.map(
          Effect.tryPromise(() =>
            jose.jwtVerify(token, key, {
              algorithms: ["HS256"],
              clockTolerance: CLOCK_SKEW_LEEWAY_SECONDS,
            })
          ),
          (r) => r.payload
        ),
        () => Effect.succeed(null)
      );

      if (result !== null && result.aud === expectedOrganizationId) {
        yield* enforceTimeClaims(result);
        yield* enforceMaxLifetime(result, maxTokenLifetime);
        return result;
      }
    }
    return yield* new UnauthorizedError({ message: "Invalid JWT" });
  });

/**
 * Post-signature time-claim rules that jose does not enforce on its own.
 *
 * - `exp` is required; jose only validates it when present.
 * - `iat` must not be more than the skew tolerance into the future.
 *
 * Fails with `UnauthorizedError` mutating nothing, so it can run inside the
 * candidate-secret loop above.
 */
const enforceTimeClaims = (
  payload: jose.JWTPayload,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Effect.Effect<void, UnauthorizedError> =>
  Effect.gen(function* () {
    if (payload.exp === undefined) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: missing exp claim",
      });
    }

    if (
      isNumber(payload.iat) &&
      payload.iat > nowSeconds + CLOCK_SKEW_LEEWAY_SECONDS
    ) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: iat claim is in the future",
      });
    }
  });

/**
 * Rejects tokens claiming a lifetime longer than the workspace cap. When
 * `iat` is absent the token is assumed to have been minted now, so the check
 * degrades to `exp - now`, which still stops `exp = now + 30 days` tokens.
 */
const enforceMaxLifetime = (
  payload: jose.JWTPayload,
  maxTokenLifetime: Duration.Duration,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Effect.Effect<void, UnauthorizedError> =>
  Effect.gen(function* () {
    if (!isNumber(payload.exp)) {
      // enforceTimeClaims already rejected a missing exp; this is defensive
      // against a non-numeric exp that jose somehow let through.
      return yield* new UnauthorizedError({ message: "Invalid JWT" });
    }

    const issuedAt = isNumber(payload.iat) ? payload.iat : nowSeconds;
    const maxLifetimeSeconds = Duration.toSeconds(maxTokenLifetime);

    if (payload.exp - issuedAt > maxLifetimeSeconds) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: token lifetime exceeds the workspace cap",
      });
    }
  });
