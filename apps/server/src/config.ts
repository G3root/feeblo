import { Config, Context, Effect, Layer } from "effect";

export class ServerConfig extends Context.Service<ServerConfig>()(
  "ServerConfig",
  {
    make: Effect.gen(function* () {
      const appUrl = yield* Config.string("VITE_APP_URL");
      const apiUrl = yield* Config.string("VITE_API_URL");

      return {
        apiUrl,
        appUrl,
      } as const;
    }),
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
