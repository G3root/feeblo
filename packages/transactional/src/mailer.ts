import { render, toPlainText } from "@react-email/render";
import { Effect, Redacted, Schema } from "effect";
import { createTransport } from "nodemailer";
import type { ReactElement } from "react";
import { MailerConfig } from "./config";

type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly react: ReactElement;
  readonly from?: string;
  readonly replyTo?: string;
};

class MailTemplateRenderError extends Schema.TaggedError<MailTemplateRenderError>()(
  "MailTemplateRenderError",
  {
    subject: Schema.String,
    cause: Schema.Defect,
  }
) {}

class MailDeliveryError extends Schema.TaggedError<MailDeliveryError>()(
  "MailDeliveryError",
  {
    subject: Schema.String,
    cause: Schema.Defect,
  }
) {}

const makeMailer = Effect.gen(function* () {
  const {
    defaultFrom,
    host,
    ignoreTLS,
    password,
    port,
    secure,
    service,
    username,
  } = yield* MailerConfig;

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
    send: Effect.fn("Mailer.send")(function* ({
      from,
      react,
      replyTo,
      subject,
      to,
    }: MailMessage) {
      const html = yield* Effect.tryPromise({
        try: () => render(react),
        catch: (cause) => new MailTemplateRenderError({ subject, cause }),
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
        catch: (cause) => new MailDeliveryError({ subject, cause }),
      });
    }),
  };
});

export class Mailer extends Effect.Service<Mailer>()("Mailer", {
  effect: makeMailer.pipe(Effect.provide(MailerConfig.layer)),
}) {
  static readonly layer = this.Default;
}
