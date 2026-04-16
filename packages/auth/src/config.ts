import { optionalString } from "@feeblo/config/effect";
import { Config, Effect } from "effect";

export class AuthConfig extends Effect.Service<AuthConfig>()("AuthConfig", {
  effect: Effect.gen(function* () {
    const appUrl = yield* Config.string("VITE_APP_URL");
    const apiUrl = yield* Config.string("VITE_API_URL");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");
    const githubClientId = yield* optionalString("GITHUB_CLIENT_ID");
    const githubClientSecret = yield* optionalString("GITHUB_CLIENT_SECRET");
    const googleClientId = yield* optionalString("GOOGLE_CLIENT_ID");
    const googleClientSecret = yield* optionalString("GOOGLE_CLIENT_SECRET");

    return {
      apiUrl,
      appUrl,
      githubClientId,
      githubClientSecret,
      googleClientId,
      googleClientSecret,
      secret,
    } as const;
  }),
}) {
  static readonly layer = this.Default;
}
