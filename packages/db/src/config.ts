import { Config, Context, Effect, Layer } from "effect";

export class DatabaseConfig extends Context.Service<DatabaseConfig>()(
  "DatabaseConfig",
  {
    make: Effect.gen(function* () {
      const url = yield* Config.redacted("DATABASE_URL").asEffect();
      return { url } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
