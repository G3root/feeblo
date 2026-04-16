import { Config, Effect } from "effect";
import { InternalServerError } from "../rpc-errors";

export class VerificationOtpConfig extends Effect.Service<VerificationOtpConfig>()(
  "VerificationOtpConfig",
  {
    effect: Effect.gen(function* () {
      const appUrl = yield* Config.string("VITE_APP_URL").pipe(
        Effect.mapError(
          () => new InternalServerError({ message: "Missing VITE_APP_URL" })
        )
      );
      const secret = yield* Config.string("AUTH_ENCRYPTION_KEY").pipe(
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
  static readonly layer = this.Default;
}
