import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RateLimiter from "effect/unstable/persistence/RateLimiter";

const otpWindow = "15 minutes";

const consumeOtp = (
  limiter: RateLimiter.RateLimiter,
  key: string,
  limit: number
) =>
  limiter.consume({
    algorithm: "fixed-window",
    key,
    limit,
    window: otpWindow,
  });

export class RateLimitService extends Context.Service<RateLimitService>()(
  "RateLimitService",
  {
    make: Effect.gen(function* () {
      const limiter = yield* RateLimiter.RateLimiter;

      const consume = Effect.fn("RateLimitService.consume")(
        (options: {
          readonly key: string;
          readonly limit: number;
          readonly window: Duration.Input;
        }) =>
          limiter.consume({
            algorithm: "fixed-window",
            ...options,
          })
      );

      const consumeEmailVerificationOtp = Effect.fn(
        "RateLimitService.consumeEmailVerificationOtp"
      )((email: string) =>
        consumeOtp(
          limiter,
          `verification-otp:email-verification:${email.trim().toLowerCase()}`,
          3
        )
      );
      const consumePasswordResetOtp = Effect.fn(
        "RateLimitService.consumePasswordResetOtp"
      )((email: string) =>
        consumeOtp(
          limiter,
          `verification-otp:password-reset:${email.trim().toLowerCase()}`,
          3
        )
      );
      const consumeSignInOtp = Effect.fn("RateLimitService.consumeSignInOtp")(
        (email: string) =>
          consumeOtp(
            limiter,
            `verification-otp:sign-in:${email.trim().toLowerCase()}`,
            5
          )
      );

      return {
        consume,
        consumeEmailVerificationOtp,
        consumePasswordResetOtp,
        consumeSignInOtp,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
  static readonly layerMemory: Layer.Layer<RateLimitService> =
    RateLimitService.layer.pipe(
      Layer.provide(RateLimiter.layer),
      Layer.provide(RateLimiter.layerStoreMemory)
    );
}
