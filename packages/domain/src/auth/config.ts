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
  static readonly layer = Layer.effect(this, this.make);
}
