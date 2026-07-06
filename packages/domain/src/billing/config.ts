import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

const PolarModeConfig = Config.schema(
  Schema.Literals(["sandbox", "production"]),
  "POLAR_MODE"
).pipe(Config.withDefault("sandbox"));

export class PolarConfig extends Context.Service<PolarConfig>()("PolarConfig", {
  make: Effect.gen(function* () {
    const appUrl = yield* Config.string("APP_URL");
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
  static readonly layer = Layer.effect(this, this.make);
}
