import { optionalString } from "@feeblo/config/effect";
import { Config, Context, Effect, Layer } from "effect";

export class AuthConfig extends Context.Service<AuthConfig>()("AuthConfig", {
  make: Effect.gen(function* () {
    const appUrl = yield* Config.string("APP_URL");
    const apiUrl = yield* Config.string("API_URL");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");
    const githubClientId = yield* optionalString("GITHUB_CLIENT_ID");
    const githubClientSecret = yield* optionalString("GITHUB_CLIENT_SECRET");
    const googleClientId = yield* optionalString("GOOGLE_CLIENT_ID");
    const googleClientSecret = yield* optionalString("GOOGLE_CLIENT_SECRET");
    const trustedOrigins = yield* Config.string("AUTH_TRUSTED_ORIGINS");
    const turnstileKey = yield* optionalString("TURNSTILE_SECRET_KEY");
    const allowedEmails = yield* optionalString("ALLOWED_EMAILS");
    const signUpEnabled = yield* Config.boolean("AUTH_SIGN_UP_ENABLED").pipe(
      Config.withDefault(true)
    );

    return {
      apiUrl,
      appUrl,
      githubClientId,
      githubClientSecret,
      googleClientId,
      googleClientSecret,
      secret,
      signUpEnabled,
      trustedOrigins,
      turnstileKey,
      allowedEmails,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
