import { render, toPlainText } from "@react-email/render";
import { Config, Effect, Redacted } from "effect";
import { createTransport } from "nodemailer";
import type { ReactElement } from "react";

type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly react: ReactElement;
  readonly from?: string;
  readonly replyTo?: string;
};

const optionalString = (name: string) =>
  Config.string(name).pipe(
    Config.option,
    Effect.map((value) =>
      value._tag === "Some" && value.value.trim() !== ""
        ? value
        : { _tag: "None" as const }
    )
  );

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

export class Mailer extends Effect.Service<Mailer>()("Mailer", {
  effect: Effect.gen(function* () {
    const host = yield* optionalString("SMTP_HOST").pipe(
      Effect.map((value) => (value._tag === "Some" ? value.value : "127.0.0.1"))
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

    const transport = createTransport({
      host,
      port,
      secure,
      ignoreTLS,
      auth:
        username._tag === "Some"
          ? {
              user: username.value,
              ...(password._tag === "Some"
                ? { pass: Redacted.value(password.value) }
                : {}),
            }
          : undefined,
      ...(service._tag === "Some" ? { service: service.value } : {}),
    });

    return {
      send: ({ from, react, replyTo, subject, to }: MailMessage) =>
        Effect.gen(function* () {
          const html = yield* Effect.tryPromise({
            try: () => render(react),
            catch: (cause) =>
              new Error("Failed to render email template", { cause }),
          });

          const text = toPlainText(html);

          yield* Effect.tryPromise({
            try: () =>
              transport.sendMail({
                to,
                subject,
                html,
                text,
                from: from ?? defaultFrom,
                ...(replyTo ? { replyTo } : {}),
              }),
            catch: (cause) =>
              new Error(`Failed to send "${subject}" email`, { cause }),
          });
        }).pipe(Effect.withSpan("Mailer.send")),
    };
  }),
}) {}
