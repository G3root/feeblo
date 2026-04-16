import { Config, Effect } from "effect";

export class ServerConfig extends Effect.Service<ServerConfig>()(
  "ServerConfig",
  {
    effect: Effect.gen(function* () {
      const appUrl = yield* Config.string("VITE_APP_URL");
      const apiUrl = yield* Config.string("VITE_API_URL");

      return {
        apiUrl,
        appUrl,
      } as const;
    }),
  }
) {
  static readonly layer = this.Default;
}
