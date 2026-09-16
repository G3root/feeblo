import { optionalString } from "@feeblo/config/effect";
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

/**
 * Minimum byte length for `AUTH_ENCRYPTION_KEY`. The key signs better-auth
 * session cookies, encrypts OAuth state, derives email-subscription tokens,
 * and falls back to encrypting integration credentials, so a short or default
 * value (for example the `"secret"` shipped in `.env.example`) would make all
 * of those forgeable. Enforced in production so local development keeps the
 * documented placeholder workflow.
 */
const MIN_AUTH_ENCRYPTION_KEY_BYTES = 32;

const assertProductionEncryptionKey = (
  nodeEnv: string,
  secret: Redacted.Redacted<string>
) =>
  Effect.gen(function* () {
    if (nodeEnv !== "production") {
      return;
    }
    const byteLength = new TextEncoder().encode(
      Redacted.value(secret)
    ).byteLength;
    if (byteLength < MIN_AUTH_ENCRYPTION_KEY_BYTES) {
      return yield* Effect.fail(
        new Config.ConfigError(
          new ConfigProvider.SourceError({
            message: `AUTH_ENCRYPTION_KEY must be at least ${MIN_AUTH_ENCRYPTION_KEY_BYTES} bytes in production (received ${byteLength}). Generate one with: openssl rand -hex 32`,
          })
        )
      );
    }
  });

export class AuthConfig extends Context.Service<AuthConfig>()("AuthConfig", {
  make: Effect.gen(function* () {
    const appUrl = yield* Config.string("APP_URL");
    const apiUrl = yield* Config.string("API_URL");
    const appRootDomain = yield* Config.string("APP_ROOT_DOMAIN");
    const secret = yield* Config.redacted("AUTH_ENCRYPTION_KEY");
    const githubClientId = yield* optionalString("GITHUB_CLIENT_ID");
    const githubClientSecret = yield* optionalString("GITHUB_CLIENT_SECRET");
    const googleClientId = yield* optionalString("GOOGLE_CLIENT_ID");
    const googleClientSecret = yield* optionalString("GOOGLE_CLIENT_SECRET");
    // When set, the corresponding social provider is pointed at the local
    // OAuth emulator (vercel-labs/emulate) instead of the real provider.
    const githubEmulatorUrl = yield* optionalString("GITHUB_EMULATOR_URL");
    const googleEmulatorUrl = yield* optionalString("GOOGLE_EMULATOR_URL");
    const trustedOrigins = yield* optionalString("AUTH_TRUSTED_ORIGINS");
    const turnstileKey = yield* optionalString("TURNSTILE_SECRET_KEY");
    const allowedEmails = yield* optionalString("ALLOWED_EMAILS");
    const nodeEnv = yield* Config.string("NODE_ENV").pipe(
      Config.withDefault("development")
    );
    const signUpEnabled = yield* Config.boolean("AUTH_SIGN_UP_ENABLED").pipe(
      Config.withDefault(true)
    );
    const emailVerificationRequired = yield* Config.boolean(
      "AUTH_EMAIL_VERIFICATION_REQUIRED"
    ).pipe(Config.withDefault(true));
    const autoSignInAfterSignUp = yield* Config.boolean(
      "AUTH_AUTO_SIGN_IN_AFTER_SIGN_UP"
    ).pipe(Config.withDefault(false));

    yield* assertProductionEncryptionKey(nodeEnv, secret);

    return {
      apiUrl,
      appUrl,
      githubClientId,
      githubClientSecret,
      googleClientId,
      googleClientSecret,
      githubEmulatorUrl,
      googleEmulatorUrl,
      secret,
      signUpEnabled,
      emailVerificationRequired,
      autoSignInAfterSignUp,
      trustedOrigins,
      turnstileKey,
      allowedEmails,
      nodeEnv,
      appRootDomain,
    } as const;
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
