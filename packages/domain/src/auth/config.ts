import { Config, Context, Effect, Layer } from "effect";
import { InternalServerError } from "../rpc-errors";

export class VerificationOtpConfig extends Context.Service<VerificationOtpConfig>()(
  "VerificationOtpConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.string("VITE_APP_URL").asEffect().pipe(
        Effect.mapError(
          () => new InternalServerError({ message: "Missing VITE_APP_URL" })
        )
      );
      const secret = yield* Config.string("AUTH_ENCRYPTION_KEY")
        .asEffect()
        .pipe(
        Effect.mapError(
          () =>
            new InternalServerError({ message: "Missing AUTH_ENCRYPTION_KEY" })
        )
      );

      return {
        appUrl,
        secret,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
