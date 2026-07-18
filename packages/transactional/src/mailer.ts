import { render, toPlainText } from "@react-email/render";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import { createTransport } from "nodemailer";
import type { ReactElement } from "react";
import { MailerConfig } from "./config";

export type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly react: ReactElement;
  readonly from?: string;
  readonly replyTo?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly messageId?: string;
};

export class MailTemplateRenderError extends Schema.TaggedErrorClass<MailTemplateRenderError>()(
  "MailTemplateRenderError",
  {
    subject: Schema.String,
    cause: Schema.Defect,
  }
) {}

export class MailDeliveryError extends Schema.TaggedErrorClass<MailDeliveryError>()(
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
      headers,
      messageId,
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
            ...(headers ? { headers } : {}),
            ...(messageId ? { messageId } : {}),
          }),
        catch: (cause) => new MailDeliveryError({ subject, cause }),
      });
    }),
  };
});

export class Mailer extends Context.Service<Mailer>()("Mailer", {
  make: makeMailer.pipe(Effect.provide(MailerConfig.layer)),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
