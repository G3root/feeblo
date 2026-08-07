import * as Effect from "effect/Effect";
import * as jose from "jose";

import { UnauthorizedError } from "../rpc-errors";

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
 * An `exp` claim is optional but, when present, is validated by jose — an
 * expired token is rejected. Minting short-lived tokens is still strongly
 * recommended (see docs/widget-sso.md).
 */
export const verifyJwt = (
  token: string,
  secrets: readonly string[],
  expectedOrganizationId: string
): Effect.Effect<jose.JWTPayload, UnauthorizedError> =>
  Effect.gen(function* () {
    for (const secret of secrets) {
      const key = new TextEncoder().encode(secret);

      // jwtVerify rejects expired tokens (when `exp` is present) and tokens
      // with an invalid signature; any failure just moves on to the next
      // candidate secret (active first, then the 24h-grace revoked one).
      const result = yield* Effect.catch(
        Effect.map(
          Effect.tryPromise(() =>
            jose.jwtVerify(token, key, { algorithms: ["HS256"] })
          ),
          (r) => r.payload
        ),
        () => Effect.succeed(null)
      );

      if (result !== null && result.aud === expectedOrganizationId) {
        return result;
      }
    }
    return yield* new UnauthorizedError({ message: "Invalid JWT" });
  });
