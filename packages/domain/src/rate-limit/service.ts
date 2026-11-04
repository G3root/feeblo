import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RateLimiter from "effect/persistence/RateLimiter";

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
  /**
   * The in-memory store with its janitor fiber already stopped.
   *
   * `RateLimiter.layerStoreMemory` forks a sweep on `Schedule.spaced("1
   * minute")` into the scope it is built in. Under `TestClock` that fiber is a
   * hazard rather than housekeeping: `TestClock.setTime` wakes each sleep due
   * before the target instant one at a time and waits for the woken fiber to
   * suspend again, so the sweep's next sleep is due again, 60 seconds further
   * on. A test that pins the clock to a real date — `setTime(2026-08-11)` from
   * the epoch — therefore pumps ~29 million wake-ups and never returns. The
   * store answers an expired entry exactly like a missing one on read (the
   * window state is recomputed per `consume`), so nothing a test can observe
   * depends on the sweep. Building the store in a scope that closes
   * immediately keeps the store value and drops the fiber.
   */
  static readonly layerMemory: Layer.Layer<RateLimitService> =
    RateLimitService.layer.pipe(
      Layer.provide(RateLimiter.layer),
      Layer.provide(
        Layer.unwrap(
          Effect.map(
            Effect.scoped(Layer.build(RateLimiter.layerStoreMemory)),
            Layer.succeedContext
          )
        )
      )
    );
}
