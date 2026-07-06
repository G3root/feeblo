import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class DatabaseConfig extends Context.Service<DatabaseConfig>()(
  "DatabaseConfig",
  {
    make: Effect.gen(function* () {
      const url = yield* Config.redacted("DATABASE_URL");
      return { url } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
