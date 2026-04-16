import { Config, Effect, Schema } from "effect";

const PolarModeConfig = Schema.Config(
  "POLAR_MODE",
  Schema.Literal("sandbox", "production")
).pipe(Config.withDefault("sandbox"));

export class PolarConfig extends Effect.Service<PolarConfig>()("PolarConfig", {
  effect: Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const accessToken = yield* Config.redacted("POLAR_ACCESS_TOKEN").pipe(
      Config.option
    );
    const webhookSecret = yield* Config.redacted("POLAR_WEBHOOK_SECRET").pipe(
      Config.option
    );
    const server = yield* PolarModeConfig;

    return {
      accessToken,
      appUrl,
      server,
      webhookSecret,
    } as const;
  }),
}) {
  static readonly layer = this.Default;
}
