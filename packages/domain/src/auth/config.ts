import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { InternalServerError } from "../rpc-errors";

export class VerificationOtpConfig extends Context.Service<VerificationOtpConfig>()(
  "VerificationOtpConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.string("APP_URL").pipe(
        Effect.mapError(
          () => new InternalServerError({ message: "Missing APP_URL" })
        )
      );
      const nodeEnv = yield* Config.string("NODE_ENV").pipe(
        Config.withDefault("development"),
        Effect.mapError(
          () =>
            new InternalServerError({
              message: "Invalid NODE_ENV configuration",
            })
        )
      );
      const secret = yield* Config.string("AUTH_ENCRYPTION_KEY").pipe(
        Effect.mapError(
          () =>
            new InternalServerError({ message: "Missing AUTH_ENCRYPTION_KEY" })
        )
      );

      // Same production floor as AuthConfig: this key encrypts the
      // verification-OTP cookie, so a short default in production would make
      // the cookie forgeable.
      if (
        nodeEnv === "production" &&
        new TextEncoder().encode(secret).byteLength < 32
      ) {
        return yield* new InternalServerError({
          message:
            "AUTH_ENCRYPTION_KEY must be at least 32 bytes in production. Generate one with: openssl rand -hex 32",
        });
      }

      return {
        appUrl,
        secret,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
