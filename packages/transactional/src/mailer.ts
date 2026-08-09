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
  /** A caller-supplied RFC Message-ID used for delivery idempotency. */
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

export interface MailProviderMetadata
  extends Schema.Schema.Type<typeof MailProviderMetadata> {}

/** Provider-neutral result of one mail submission attempt. */
export const MailSendResult = Schema.Struct({
  accepted: Schema.Boolean,
  messageId: BoundedMessageId,
  providerMetadata: MailProviderMetadata,
});

export interface MailSendResult
  extends Schema.Schema.Type<typeof MailSendResult> {}

/** The normalized receipt returned by a concrete outbound mail transport. */
export const MailTransportReceipt = Schema.Struct({
  acceptedRecipientCount: MailProviderMetadata.fields.acceptedRecipientCount,
  messageId: BoundedMessageId,
  providerMessageId: MailProviderMetadata.fields.providerMessageId,
  rejectedRecipientCount: MailProviderMetadata.fields.rejectedRecipientCount,
  responseCode: MailProviderMetadata.fields.responseCode,
});

export interface MailTransportReceipt
  extends Schema.Schema.Type<typeof MailTransportReceipt> {}

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
export class MailTemplateRenderError extends Schema.TaggedErrorClass<MailTemplateRenderError>()(
  "MailTemplateRenderError",
  {}
) {}

/** The provider rejected the message permanently; retrying will not help. */
export class MailPermanentDeliveryError extends Schema.TaggedErrorClass<MailPermanentDeliveryError>()(
  "MailPermanentDeliveryError",
  {
    smtpStatusCode: Schema.optionalKey(SmtpResponseCode),
  }
) {}

/** The provider reported a temporary failure that may succeed on retry. */
export class MailTemporaryDeliveryError extends Schema.TaggedErrorClass<MailTemporaryDeliveryError>()(
  "MailTemporaryDeliveryError",
  {
    smtpStatusCode: Schema.optionalKey(SmtpResponseCode),
  }
) {}

/** The submission outcome is unknown, so at-least-once delivery may retry it. */
export class MailUncertainDeliveryError extends Schema.TaggedErrorClass<MailUncertainDeliveryError>()(
  "MailUncertainDeliveryError",
  {}
) {}

/** Backwards-compatible delivery-error schema for workflow definitions. */
export const MailDeliveryError = Schema.Union([
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

const smtpResponseCode = (response: string): number | undefined => {
  const match = /^(\d{3})\b/.exec(response);
  if (!match?.[1]) {
    return undefined;
  }

  return Option.getOrUndefined(
    Schema.decodeUnknownOption(SmtpResponseCode)(Number(match[1]))
  );
};

const classifyNodemailerFailure = (
  cause: unknown
): MailPermanentDeliveryError | MailTemporaryDeliveryError | MailUncertainDeliveryError => {
  const details = Option.getOrUndefined(
    Schema.decodeUnknownOption(NodemailerErrorDetails)(cause)
  );
  const smtpStatusCode = details?.responseCode;

  if (smtpStatusCode !== undefined) {
    if (smtpStatusCode >= 400 && smtpStatusCode < 500) {
      return new MailTemporaryDeliveryError({ smtpStatusCode });
    }
    if (smtpStatusCode >= 500) {
      return new MailPermanentDeliveryError({ smtpStatusCode });
    }
  }

  if (details?.code && temporaryNodemailerCodes.has(details.code)) {
    return new MailTemporaryDeliveryError({});
  }

  return new MailUncertainDeliveryError({});
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
      catch: () => new MailTemplateRenderError({}),
    });
    const text = yield* Effect.try({
      try: () => toPlainText(html),
      catch: () => new MailTemplateRenderError({}),
    });

    const receipt = yield* transport.send({
      ...message,
      html,
      text,
    }).pipe(
      Effect.flatMap((transportReceipt) =>
        Schema.decodeUnknownEffect(MailTransportReceipt)(transportReceipt).pipe(
          Effect.mapError(() => new MailUncertainDeliveryError({}))
        )
      )
    );
    return toMailSendResult(receipt, message.messageId);
  }),
});

/** Builds a Mailer layer from a provider-neutral transport for production and integration tests. */
export const makeMailerLayer = (transport: MailerTransport): Layer.Layer<Mailer> =>
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
            Effect.mapError(() => new MailUncertainDeliveryError({}))
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
