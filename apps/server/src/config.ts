import { Config, Context, Effect, Layer } from "effect";

export class ServerConfig extends Context.Service<ServerConfig>()(
  "ServerConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.string("APP_URL");
      const apiUrl = yield* Config.string("API_URL");
      const appRootDomain = yield* Config.string("APP_ROOT_DOMAIN");
      const nodeEnv = yield* Config.string("NODE_ENV").pipe(
        Config.withDefault("development")
      );

      return {
        apiUrl,
        appUrl,
        appRootDomain,
        nodeEnv,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
