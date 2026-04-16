import { optionalString } from "@feeblo/config/effect";
import { Config, Effect } from "effect";

const optionalBoolean = (name: string) =>
  optionalString(name).pipe(
    Effect.flatMap((value) => {
      if (value._tag === "None") {
        return Config.succeed(undefined);
      }

      if (value.value === "true") {
        return Config.succeed(true);
      }

      if (value.value === "false") {
        return Config.succeed(false);
      }

      return Config.fail(
        `Expected ${name} to be "true" or "false", received "${value.value}"`
      );
    })
  );

const optionalInteger = (name: string) =>
  optionalString(name).pipe(
    Effect.flatMap((value) => {
      if (value._tag === "None") {
        return Config.succeed(undefined);
      }

      const parsed = Number(value.value);
      return Number.isInteger(parsed)
        ? Config.succeed(parsed)
        : Config.fail(
            `Expected ${name} to be an integer, received "${value.value}"`
          );
    })
  );

export class MailerConfig extends Effect.Service<MailerConfig>()(
  "MailerConfig",
  {
    effect: Effect.gen(function* () {
      const host = yield* optionalString("SMTP_HOST").pipe(
        Effect.map((value) =>
          value._tag === "Some" ? value.value : "127.0.0.1"
        )
      );
      const port = yield* optionalInteger("SMTP_PORT").pipe(
        Effect.map((value) => value ?? 2500)
      );
      const secure = yield* optionalBoolean("SMTP_SECURE").pipe(
        Effect.map((value) => value ?? false)
      );
      const ignoreTLS = yield* optionalBoolean("SMTP_UNSAFE_IGNORE_TLS").pipe(
        Effect.map((value) => value ?? false)
      );
      const service = yield* optionalString("SMTP_SERVICE");
      const username = yield* optionalString("SMTP_USERNAME");
      const password = yield* Config.redacted("SMTP_PASSWORD").pipe(
        Config.option
      );
      const defaultFrom = yield* optionalString("MAILER_FROM").pipe(
        Effect.map((value) =>
          value._tag === "Some" ? value.value : "Feeblo <noreply@feeblo.com>"
        )
      );

      return {
        defaultFrom,
        host,
        ignoreTLS,
        password,
        port,
        secure,
        service,
        username,
      } as const;
    }),
  }
) {
  static readonly layer = this.Default;
}
