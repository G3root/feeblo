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
 * Feeblo's. 10s comfortably absorbs NTP-synced server clocks while keeping
 * the "expired but accepted" window negligible next to mint-on-demand tokens
 * (5-minute `exp`).
 */
export const CLOCK_SKEW_LEEWAY_SECONDS = 10;

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
 * Converts the nullable `organization.jwt_max_token_lifetime_minutes` column
 * into a lifetime cap. The column has no database constraint, so stored values
 * are untrusted: the documented policy is tightening-only, so an override is
 * honored only when it is a positive integer no larger than the 24h default.
 * Any other stored value (zero, negative, oversized, non-integer) falls back
 * to the default rather than extending JWT replay or breaking sign-ins.
 */
export const maxTokenLifetimeFromMinutes = (
  minutes: number | null
): Duration.Duration =>
  minutes !== null &&
  Number.isInteger(minutes) &&
  minutes > 0 &&
  minutes <= Duration.toMinutes(DEFAULT_MAX_TOKEN_LIFETIME)
    ? Duration.minutes(minutes)
    : DEFAULT_MAX_TOKEN_LIFETIME;

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
 * The `exp` and `iat` claims are **required**: a token without either is
 * rejected after the signature verifies (jose only validates `exp` when
 * present, so absence is checked here). `exp`/`nbf` are checked by jose with
 * a 10s clock-skew tolerance. `iat` is additionally rejected when it lies more
 * than 10s in the future (a fresh token can never legitimately carry a future
 * `iat`).
 *
 * The total token lifetime (`exp - iat`) is capped at
 * {@link DEFAULT_MAX_TOKEN_LIFETIME} or the per-org override in
 * `options.maxTokenLifetime`, so `exp = now + 30 days` is rejected even though
 * the signature is valid.
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
  options: {
    readonly maxTokenLifetime?: Duration.Duration;
    /**
     * Test seam: pins "now" (UNIX seconds) for the post-signature time-claim
     * rules. Production callers omit it; the wall clock is used.
     */
    readonly nowSeconds?: number;
  } = {}
): Effect.Effect<jose.JWTPayload, UnauthorizedError> =>
  Effect.gen(function* () {
    if (token.length > MAX_JWT_LENGTH) {
      return yield* new UnauthorizedError({ message: "Invalid JWT" });
    }

    const maxTokenLifetime =
      options.maxTokenLifetime ?? DEFAULT_MAX_TOKEN_LIFETIME;
    const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);

    for (const secret of secrets) {
      const key = secretToKey(secret);

      // jwtVerify rejects expired tokens (or tokens with an invalid
      // signature); any failure just moves on to the next candidate secret
      // (active first, then the 24h-grace revoked one). `clockTolerance`
      // gives both sides a 10s clock-skew allowance.
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
        yield* enforceTimeClaims(result, nowSeconds);
        yield* enforceMaxLifetime(result, maxTokenLifetime);
        return result;
      }
    }
    return yield* new UnauthorizedError({ message: "Invalid JWT" });
  });

/**
 * Post-signature time-claim rules that jose does not enforce on its own.
 *
 * - `exp` and `iat` are required; jose only validates `exp` when present.
 * - Both must be numbers (jose ignores non-numeric time claims).
 * - `iat` must not be more than the skew tolerance into the future.
 *
 * Fails with `UnauthorizedError` mutating nothing, so it can run inside the
 * candidate-secret loop above.
 */
const enforceTimeClaims = (
  payload: jose.JWTPayload,
  nowSeconds: number
): Effect.Effect<void, UnauthorizedError> =>
  Effect.gen(function* () {
    if (payload.exp === undefined) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: missing exp claim",
      });
    }

    if (!isNumber(payload.exp)) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: exp claim must be a number",
      });
    }

    if (payload.iat === undefined) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: missing iat claim",
      });
    }

    if (!isNumber(payload.iat)) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: iat claim must be a number",
      });
    }

    if (payload.iat > nowSeconds + CLOCK_SKEW_LEEWAY_SECONDS) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: iat claim is in the future",
      });
    }
  });

/**
 * Rejects tokens claiming a lifetime longer than the workspace cap. Both
 * `exp` and `iat` are already enforced as numeric claims by
 * {@link enforceTimeClaims}; this is a defensive re-check plus the cap math.
 */
const enforceMaxLifetime = (
  payload: jose.JWTPayload,
  maxTokenLifetime: Duration.Duration
): Effect.Effect<void, UnauthorizedError> =>
  Effect.gen(function* () {
    if (!isNumber(payload.exp) || !isNumber(payload.iat)) {
      // enforceTimeClaims already rejected missing/non-numeric exp or iat;
      // this is defensive against a payload that somehow got through.
      return yield* new UnauthorizedError({ message: "Invalid JWT" });
    }

    const maxLifetimeSeconds = Duration.toSeconds(maxTokenLifetime);

    if (payload.exp - payload.iat > maxLifetimeSeconds) {
      return yield* new UnauthorizedError({
        message: "Invalid JWT: token lifetime exceeds the workspace cap",
      });
    }
  });
