import * as Effect from "effect/Effect";
import * as S from "effect/Schema";
import * as jose from "jose";

import { EmailConfig } from "./config";

/**
 * Stateless unsubscribe tokens: short-lived HS256 JWTs with no database rows.
 * The token carries the member + post it applies to; the unsubscribe route
 * validates signature + expiry and applies the action through the existing
 * post-subscription code. Signing follows the repo's established `jose`
 * pattern (aud-bound, exp-validated, key rotation via a secrets list).
 */
export const UNSUBSCRIBE_TOKEN_AUDIENCE = "feeblo:email-unsubscribe";

export class UnsubscribeTokenError extends S.TaggedErrorClass<UnsubscribeTokenError>()(
  "UnsubscribeTokenError",
  {
    message: S.String,
  }
) {}

export const UnsubscribeTokenPayload = S.Struct({
  action: S.Literal("unsubscribe_post"),
  memberId: S.String,
  postId: S.String,
});

export type TUnsubscribeTokenPayload = S.Schema.Type<
  typeof UnsubscribeTokenPayload
>;

const TOKEN_TTL = "30 days";

const secretKey = (secret: string) => new TextEncoder().encode(secret);

/**
 * Mints an unsubscribe token for (member, post). Returns null when no signing
 * secret is configured or signing fails (fail-open: callers fall back to the
 * settings link, matching today's behavior).
 */
export const signUnsubscribeToken = (
  memberId: string,
  postId: string
): Effect.Effect<string | null, never, EmailConfig> =>
  Effect.gen(function* () {
    const config = yield* EmailConfig;
    const [secret] = config.unsubscribeSecrets;

    if (!secret) {
      return null;
    }

    return yield* Effect.tryPromise(() =>
      new jose.SignJWT({
        action: "unsubscribe_post",
        memberId,
        postId,
      })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience(UNSUBSCRIBE_TOKEN_AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(TOKEN_TTL)
        .sign(secretKey(secret))
    ).pipe(Effect.catch(() => Effect.succeed(null)));
  });

/** Validates signature + audience + expiry, returns the token payload. */
export const verifyUnsubscribeToken = (
  token: string
): Effect.Effect<
  TUnsubscribeTokenPayload,
  UnsubscribeTokenError,
  EmailConfig
> =>
  Effect.gen(function* () {
    const config = yield* EmailConfig;

    for (const secret of config.unsubscribeSecrets) {
      const result = yield* Effect.tryPromise(() =>
        jose.jwtVerify(token, secretKey(secret), {
          algorithms: ["HS256"],
        })
      ).pipe(Effect.catch(() => Effect.succeed(null)));

      if (result === null) {
        continue;
      }

      if (result.payload.aud !== UNSUBSCRIBE_TOKEN_AUDIENCE) {
        return yield* new UnsubscribeTokenError({
          message: "Invalid unsubscribe token audience",
        });
      }

      const parsed = S.decodeUnknownOption(UnsubscribeTokenPayload)(
        result.payload
      );
      if (parsed._tag === "Some") {
        return parsed.value;
      }
    }

    return yield* new UnsubscribeTokenError({ message: "Invalid token" });
  });

/** Fallback link when no token can be minted (no signing secret configured). */
export const fallbackUnsubscribeUrl =
  "https://app.feeblo.com/settings/notifications";
