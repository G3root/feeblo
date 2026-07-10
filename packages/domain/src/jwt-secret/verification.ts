import * as Effect from "effect/Effect";
import * as jose from "jose";

import { UnauthorizedError } from "../rpc-errors";

export const verifyJwt = (
  token: string,
  secrets: readonly string[]
): Effect.Effect<jose.JWTPayload, UnauthorizedError> =>
  Effect.gen(function* () {
    for (const secret of secrets) {
      const key = new TextEncoder().encode(secret);

      const result = yield* Effect.catch(
        Effect.map(
          Effect.tryPromise(() =>
            jose.jwtVerify(token, key, { algorithms: ["HS256"] })
          ),
          (r) => r.payload
        ),
        () => Effect.succeed(null)
      );

      if (result !== null) {
        return result;
      }
    }
    return yield* new UnauthorizedError({ message: "Invalid JWT" });
  });
