import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { createTransport } from "nodemailer";
import type { ReactElement } from "react";
import { render, toPlainText } from "react-email";

import { MailerConfig } from "./config";

/** An application-owned request to send one rendered transactional email. */
export type MailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly react: ReactElement;
  readonly from?: string;
  readonly replyTo?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * A stable RFC Message-ID used for correlation and provider deduplication
   * hints. SMTP does not guarantee idempotency: retrying an ambiguous send can
   * still produce a rare duplicate.
   */
  readonly messageId?: string;
};

const BoundedMessageId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(512))
);

const SmtpResponseCode = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 100, maximum: 599 }))
);

/** Safe, bounded diagnostics returned by an outbound email provider. */
export const MailProviderMetadata = Schema.Struct({
  acceptedRecipientCount: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))
  ),
  providerMessageId: Schema.optionalKey(BoundedMessageId),
  rejectedRecipientCount: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1000 }))
  ),
  responseCode: Schema.optionalKey(SmtpResponseCode),
});

export interface MailProviderMetadata extends Schema.Schema.Type<
  typeof MailProviderMetadata
> {}

/** Provider-neutral result of one mail submission attempt. */
export const MailSendResult = Schema.Struct({
  accepted: Schema.Boolean,
  messageId: BoundedMessageId,
  providerMetadata: MailProviderMetadata,
});

export interface MailSendResult extends Schema.Schema.Type<
  typeof MailSendResult
> {}

/** The normalized receipt returned by a concrete outbound mail transport. */
export const MailTransportReceipt = Schema.Struct({
  acceptedRecipientCount: MailProviderMetadata.fields.acceptedRecipientCount,
  messageId: BoundedMessageId,
  providerMessageId: MailProviderMetadata.fields.providerMessageId,
  rejectedRecipientCount: MailProviderMetadata.fields.rejectedRecipientCount,
  responseCode: MailProviderMetadata.fields.responseCode,
});

export interface MailTransportReceipt extends Schema.Schema.Type<
  typeof MailTransportReceipt
> {}

type RenderedMailMessage = Omit<MailMessage, "react"> & {
  readonly html: string;
  readonly text: string;
};

/** A transport seam that deliberately hides provider-specific request and response types. */
export interface MailerTransport {
  readonly send: (
    message: RenderedMailMessage
  ) => Effect.Effect<
    MailTransportReceipt,
    | MailPermanentDeliveryError
    | MailTemporaryDeliveryError
    | MailUncertainDeliveryError
  >;
}

/** Provider-independent Mailer capability exposed to application workflows. */
export interface MailerService {
  readonly send: (
    message: MailMessage
  ) => Effect.Effect<
    MailSendResult,
    | MailPermanentDeliveryError
    | MailTemplateRenderError
    | MailTemporaryDeliveryError
    | MailUncertainDeliveryError
  >;
}

/** Rendering failed before a provider request was made. */
export class MailTemplateRenderError extends Schema.TaggedError<MailTemplateRenderError>()(
  "MailTemplateRenderError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
  }
) {}

/** The provider rejected the message permanently; retrying will not help. */
export class MailPermanentDeliveryError extends Schema.TaggedError<MailPermanentDeliveryError>()(
  "MailPermanentDeliveryError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
    provider: Schema.Literal("smtp"),
    providerCode: Schema.optionalKey(Schema.String),
    smtpStatusCode: Schema.optionalKey(SmtpResponseCode),
  }
) {}

/** The provider reported a temporary failure that may succeed on retry. */
export class MailTemporaryDeliveryError extends Schema.TaggedError<MailTemporaryDeliveryError>()(
  "MailTemporaryDeliveryError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
    provider: Schema.Literal("smtp"),
    providerCode: Schema.optionalKey(Schema.String),
    smtpStatusCode: Schema.optionalKey(SmtpResponseCode),
  }
) {}

/** The submission outcome is unknown, so retrying could create a duplicate. */
export class MailUncertainDeliveryError extends Schema.TaggedError<MailUncertainDeliveryError>()(
  "MailUncertainDeliveryError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
    provider: Schema.Literal("smtp"),
    providerCode: Schema.optionalKey(Schema.String),
  }
) {}

/** Delivery failures that can occur after a provider submission is attempted. */
export const MailProviderDeliveryError = Schema.Union([
  MailPermanentDeliveryError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
]);

const NodemailerErrorDetails = Schema.Struct({
  code: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))
  ),
  responseCode: Schema.optionalKey(SmtpResponseCode),
});

const temporaryNodemailerCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ESOCKET",
  "ETIMEDOUT",
]);
const smtpResponseCodePattern = /^(\d{3})\b/;

const smtpResponseCode = (response: string): number | undefined => {
  const match = smtpResponseCodePattern.exec(response);
  if (!match?.[1]) {
    return undefined;
  }

  return Option.getOrUndefined(
    Schema.decodeUnknownOption(SmtpResponseCode)(Number(match[1]))
  );
};

const classifyNodemailerFailure = (
  cause: unknown
):
  | MailPermanentDeliveryError
  | MailTemporaryDeliveryError
  | MailUncertainDeliveryError => {
  const details = Option.getOrUndefined(
    Schema.decodeUnknownOption(NodemailerErrorDetails)(cause)
  );
  const smtpStatusCode = details?.responseCode;
  const diagnostics = {
    cause,
    message: "SMTP provider submission failed",
    operation: "Mailer.NodemailerTransport.send",
    provider: "smtp" as const,
    ...(details?.code ? { providerCode: details.code } : {}),
  };

  if (smtpStatusCode !== undefined) {
    if (smtpStatusCode >= 400 && smtpStatusCode < 500) {
      return new MailTemporaryDeliveryError({ ...diagnostics, smtpStatusCode });
    }
    if (smtpStatusCode >= 500) {
      return new MailPermanentDeliveryError({ ...diagnostics, smtpStatusCode });
    }
  }

  if (details?.code && temporaryNodemailerCodes.has(details.code)) {
    return new MailTemporaryDeliveryError(diagnostics);
  }

  return new MailUncertainDeliveryError(diagnostics);
};

const toMailSendResult = (
  receipt: MailTransportReceipt,
  suppliedMessageId: string | undefined
): MailSendResult => ({
  accepted: receipt.acceptedRecipientCount > 0,
  messageId: suppliedMessageId ?? receipt.messageId,
  providerMetadata: {
    acceptedRecipientCount: receipt.acceptedRecipientCount,
    ...(receipt.providerMessageId
      ? { providerMessageId: receipt.providerMessageId }
      : {}),
    rejectedRecipientCount: receipt.rejectedRecipientCount,
    ...(receipt.responseCode !== undefined
      ? { responseCode: receipt.responseCode }
      : {}),
  },
});

const makeMailerService = (transport: MailerTransport): MailerService => ({
  send: Effect.fn("Mailer.send")(function* (message: MailMessage) {
    const html = yield* Effect.tryPromise({
      try: () => render(message.react),
      catch: (cause) =>
        new MailTemplateRenderError({
          cause,
          message: "Transactional email template rendering failed",
          operation: "Mailer.send.renderHtml",
        }),
    });
    const text = yield* Effect.try({
      try: () => toPlainText(html),
      catch: (cause) =>
        new MailTemplateRenderError({
          cause,
          message: "Rendered email plain-text conversion failed",
          operation: "Mailer.send.renderText",
        }),
    });

    const receipt = yield* transport
      .send({
        ...message,
        html,
        text,
      })
      .pipe(
        Effect.flatMap((transportReceipt) =>
          Schema.decodeUnknownEffect(MailTransportReceipt)(
            transportReceipt
          ).pipe(
            Effect.mapError(
              (cause) =>
                new MailUncertainDeliveryError({
                  cause,
                  message: "SMTP provider returned an invalid delivery receipt",
                  operation: "Mailer.send.decodeReceipt",
                  provider: "smtp",
                })
            )
          )
        )
      );
    return toMailSendResult(receipt, message.messageId);
  }),
});

/** Builds a Mailer layer from a provider-neutral transport for production and integration tests. */
export const makeMailerLayer = (
  transport: MailerTransport
): Layer.Layer<Mailer> =>
  Layer.succeed(Mailer, Mailer.of(makeMailerService(transport)));

const makeNodemailerTransport = Effect.gen(function* () {
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

  const send = Effect.fn("Mailer.NodemailerTransport.send")(
    (message: RenderedMailMessage) =>
      Effect.tryPromise({
        try: async () => {
          const receipt = await transport.sendMail({
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            from: message.from ?? defaultFrom,
            ...(message.replyTo ? { replyTo: message.replyTo } : {}),
            ...(message.headers ? { headers: message.headers } : {}),
            ...(message.messageId ? { messageId: message.messageId } : {}),
          });

          return {
            acceptedRecipientCount: receipt.accepted.length,
            messageId: receipt.messageId,
            rejectedRecipientCount: receipt.rejected.length,
            ...(smtpResponseCode(receipt.response) !== undefined
              ? { responseCode: smtpResponseCode(receipt.response) }
              : {}),
          };
        },
        catch: classifyNodemailerFailure,
      }).pipe(
        Effect.flatMap((receipt) =>
          Schema.decodeUnknownEffect(MailTransportReceipt)(receipt).pipe(
            Effect.mapError(
              (cause) =>
                new MailUncertainDeliveryError({
                  cause,
                  message: "SMTP provider returned an invalid delivery receipt",
                  operation: "Mailer.NodemailerTransport.decodeReceipt",
                  provider: "smtp",
                })
            )
          )
        )
      )
  );

  return { send } satisfies MailerTransport;
});

export class Mailer extends Context.Service<Mailer, MailerService>()("Mailer", {
  make: makeNodemailerTransport.pipe(
    Effect.map(makeMailerService),
    Effect.provide(MailerConfig.layer)
  ),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
