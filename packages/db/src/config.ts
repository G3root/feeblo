import { Config, Effect } from "effect";

export class DatabaseConfig extends Effect.Service<DatabaseConfig>()(
  "DatabaseConfig",
  {
    effect: Effect.gen(function* () {
      const url = yield* Config.redacted("DATABASE_URL");
      return { url } as const;
    }),
  }
) {
  static readonly layer = this.Default;
}
