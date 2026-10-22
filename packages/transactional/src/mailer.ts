import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { createTransport, type SendMailOptions } from "nodemailer";
import type { ReactElement } from "react";
import { render, toPlainText } from "react-email";

import { MailerConfig, MESSAGE_ID_DOMAIN } from "./config";

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

/** The rendered message a transport submits, with the React element already resolved. */
export type RenderedMailMessage = Omit<MailMessage, "react"> & {
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
    | MailUncertainDeliveryError,
    Crypto.Crypto
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

/**
 * What a permanent SMTP rejection actually rejects.
 *
 * `recipient` means the address is the problem ("user unknown", "mailbox
 * disabled") and the caller may suppress it. `sender` means the submission
 * failed while naming the envelope sender (`MAIL FROM`, or enhanced 5.1.7 /
 * 5.1.8), so the recipient is not the problem. `message` means the content,
 * size, or policy was refused. `unknown` is a 5xx without a parseable enhanced
 * status code. Only `recipient` is an address fact.
 */
export const MailPermanentFailureClass = Schema.Literals([
  "recipient",
  "sender",
  "message",
  "unknown",
]);

export type MailPermanentFailureClass = Schema.Schema.Type<
  typeof MailPermanentFailureClass
>;

/** The provider rejected the message permanently; retrying will not help. */
export class MailPermanentDeliveryError extends Schema.TaggedError<MailPermanentDeliveryError>()(
  "MailPermanentDeliveryError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    /**
     * A classification of the 5xx, derived from the enhanced status code.
     * Optional so a hand-built error from a custom transport stays valid; the
     * send path only suppresses when this is explicitly `recipient`.
     */
    failureClass: Schema.optionalKey(MailPermanentFailureClass),
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
  /**
   * The SMTP command whose reply failed, e.g. `MAIL FROM` or `RCPT TO`.
   * A failure at `MAIL FROM` names the sender, never the recipient.
   */
  command: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))
  ),
  /**
   * The provider's reply text. It may name the recipient, so it is only
   * inspected here for the enhanced status code and never persisted. The
   * schema does not bound it: a value over the limit would fail the whole
   * decode and discard `responseCode` with it, turning a classifiable
   * temporary failure into an uncertain one. The caller truncates instead.
   */
  response: Schema.optionalKey(Schema.String),
  responseCode: Schema.optionalKey(SmtpResponseCode),
});

/**
 * RFC 3463 enhanced status code, e.g. the `5.1.1` in
 * `550 5.1.1 <x@example.com>: Recipient address rejected`.
 *
 * The code only counts when it follows the three-digit reply code that starts
 * a reply line. Matching it anywhere would let a recipient address or free-form
 * diagnostic text that happens to contain `5.1.1` decide whether an address is
 * suppressed. Reply codes on continuation lines use `-` instead of a space.
 */
const enhancedStatusCodePattern = /^\d{3}[ -]([245])\.(\d{1,3})\.(\d{1,3})\b/m;

/**
 * Classifies a permanent rejection by what it rejects.
 *
 * Only an address-level refusal may suppress the recipient: a policy or
 * content rejection (5.7.x, 5.6.x) and a system failure (5.3.x) would suppress
 * a deliverable address if they were treated as an address fact, and a
 * sender-address failure (5.1.7, 5.1.8, or any refusal during `MAIL FROM`) is
 * about our own identity, not the person we are writing to. Codes without an
 * enhanced status fall back to the three unambiguous SMTP replies.
 */
export const classifyPermanentFailure = (args: {
  readonly command?: string | undefined;
  readonly response?: string | undefined;
  readonly responseCode?: number | undefined;
}): MailPermanentFailureClass => {
  // The failed command is the strongest signal: a rejection during `MAIL FROM`
  // happens before any recipient is named, whatever enhanced code the server
  // chose to attach.
  const command = args.command?.trim().toUpperCase();
  if (command !== undefined && command.startsWith("MAIL")) {
    return "sender";
  }

  const enhanced =
    args.response === undefined
      ? undefined
      : enhancedStatusCodePattern.exec(args.response);
  const subject = enhanced?.[2] === undefined ? undefined : Number(enhanced[2]);
  const detail = enhanced?.[3] === undefined ? undefined : Number(enhanced[3]);

  if (subject !== undefined) {
    if (subject === 1) {
      // 5.1.7 (bad sender mailbox) and 5.1.8 (bad sender system) are sender
      // facts; the other 5.1.x codes are addressing failures of the recipient.
      return detail === 7 || detail === 8 ? "sender" : "recipient";
    }
    // 5.2.1 = mailbox disabled; 5.2.2 = mailbox full.
    if (subject === 2 && (detail === 1 || detail === 2)) {
      return "recipient";
    }
    // 5.2.3, 5.3.x, 5.6.x, 5.7.x all describe the message or the sending host.
    return "message";
  }

  switch (args.responseCode) {
    case 551:
    case 553:
      return "recipient";
    case 552:
      return "message";
    default:
      return "unknown";
  }
};

/** True when the 5xx is a temporary mailbox condition, not a final rejection. */
const isMailboxFullResponse = (response: string | undefined): boolean => {
  if (response === undefined) {
    return false;
  }
  const enhanced = enhancedStatusCodePattern.exec(response);
  return enhanced?.[2] === "2" && enhanced[3] === "2";
};

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
    Schema.decodeOption(SmtpResponseCode)(Number(match[1]))
  );
};

export const classifyNodemailerFailure = (
  cause: unknown
):
  | MailPermanentDeliveryError
  | MailTemporaryDeliveryError
  | MailUncertainDeliveryError => {
  const details = Option.getOrUndefined(
    Schema.decodeUnknownOption(NodemailerErrorDetails)(cause)
  );
  // The reply is inspected and never persisted, so cap it here rather than in
  // the decoder, where an over-limit value would also discard `responseCode`.
  const response = details?.response?.slice(0, 2048);
  const smtpStatusCode = details?.responseCode;
  const diagnostics = {
    cause,
    message: "SMTP provider submission failed",
    operation: "Mailer.NodemailerTransport.send",
    provider: "smtp" as const,
    ...(details?.code && { providerCode: details.code }),
  };

  if (smtpStatusCode !== undefined) {
    if (smtpStatusCode >= 400 && smtpStatusCode < 500) {
      return new MailTemporaryDeliveryError({ ...diagnostics, smtpStatusCode });
    }
    if (smtpStatusCode >= 500 && isMailboxFullResponse(response)) {
      // A full mailbox is a 5xx in SMTP semantics but a temporary condition in
      // practice; suppressing it would permanently drop a deliverable address.
      return new MailTemporaryDeliveryError({ ...diagnostics, smtpStatusCode });
    }
    if (smtpStatusCode >= 500) {
      return new MailPermanentDeliveryError({
        ...diagnostics,
        failureClass: classifyPermanentFailure({
          command: details?.command,
          response,
          responseCode: smtpStatusCode,
        }),
        smtpStatusCode,
      });
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
    ...(receipt.providerMessageId && {
      providerMessageId: receipt.providerMessageId,
    }),
    rejectedRecipientCount: receipt.rejectedRecipientCount,
    ...(receipt.responseCode !== undefined && {
      responseCode: receipt.responseCode,
    }),
  },
});

// Email header names are case-insensitive (RFC 5322), so a caller-supplied
// entity ref header in any casing must suppress the generated default.
const findEntityRefIdHeaderName = (
  headers: Readonly<Record<string, string>> | undefined
): string | undefined =>
  Object.keys(headers ?? {}).find(
    (name) => name.toLowerCase() === "x-entity-ref-id"
  );

const makeMailerService = (transport: MailerTransport): MailerService => ({
  send: Effect.fn("Mailer.send")(function* (message: MailMessage) {
    const crypto = yield* Crypto.Crypto;
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
    // Every message leaves with a Message-ID on a domain the deployment
    // controls. Without one, nodemailer falls back to a timestamp observed on
    // the sending host, which is both an unpredictable identifier and a
    // deliverability signal. Outbox deliveries supply their own deterministic
    // id; direct sends (verification, password reset, onboarding) get this one.
    const messageId =
      message.messageId ??
      `<${yield* crypto.randomUUIDv7.pipe(Effect.orDie)}@${MESSAGE_ID_DOMAIN}>`;

    // The transport contract returns an already-validated MailTransportReceipt
    // (the concrete transport decodes provider output at its own boundary), so
    // no second decode happens per send.
    const receipt = yield* transport.send({
      ...message,
      messageId,
      // Outlook groups emails with the same subject into one conversation
      // thread; a unique per-send X-Entity-Ref-ID keeps unrelated transactional
      // emails separate. Caller-supplied headers take precedence in any casing.
      headers: {
        ...(findEntityRefIdHeaderName(message.headers) === undefined && {
          "X-Entity-Ref-ID": yield* crypto.randomUUIDv7().pipe(Effect.orDie),
        }),
        ...message.headers,
      },
      html,
      text,
    });
    return toMailSendResult(receipt, messageId);
  }),
});

/** Builds a Mailer layer from a provider-neutral transport for production and integration tests. */
export const makeMailerLayer = (
  transport: MailerTransport
): Layer.Layer<Mailer> =>
  Layer.succeed(Mailer, Mailer.of(makeMailerService(transport)));

/**
 * Folds deployment defaults onto one rendered message.
 *
 * Both defaults come from `MailerConfig` and a message-level value always wins,
 * so a workflow can route one email's replies to a different inbox without
 * changing the deployment-wide sender.
 */
export const makeNodemailerSendOptions = (args: {
  readonly defaultFrom: string;
  readonly defaultReplyTo: Option.Option<string>;
  readonly message: RenderedMailMessage;
}): SendMailOptions => {
  const { message } = args;
  const configuredReplyTo = Option.getOrUndefined(args.defaultReplyTo);
  // Blank counts as unset: an empty header is not a reply address, and
  // emitting one is worse than inheriting the configured default.
  const replyTo =
    message.replyTo?.trim() || configuredReplyTo?.trim() || undefined;

  return {
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    from: message.from ?? args.defaultFrom,
    ...(replyTo !== undefined && { replyTo }),
    ...(message.headers && { headers: message.headers }),
    ...(message.messageId && { messageId: message.messageId }),
  };
};

const makeNodemailerTransport = Effect.gen(function* () {
  const {
    defaultFrom,
    host,
    ignoreTLS,
    password,
    port,
    replyTo: defaultReplyTo,
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
            ...(password._tag === "Some" && {
              pass: Redacted.value(password.value),
            }),
          }
        : undefined,
    ...(service._tag === "Some" && { service: service.value }),
  });

  const send = Effect.fn("Mailer.NodemailerTransport.send")(
    (message: RenderedMailMessage) =>
      Effect.tryPromise({
        try: async () => {
          const receipt = await transport.sendMail(
            makeNodemailerSendOptions({ defaultFrom, defaultReplyTo, message })
          );

          return {
            acceptedRecipientCount: (receipt.accepted ?? []).length,
            messageId: receipt.messageId,
            rejectedRecipientCount: (receipt.rejected ?? []).length,
            ...(smtpResponseCode(receipt.response ?? "") !== undefined && {
              responseCode: smtpResponseCode(receipt.response ?? ""),
            }),
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
  make: makeNodemailerTransport.pipe(Effect.map(makeMailerService)),
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(MailerConfig.layer)
  );
}
