import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
