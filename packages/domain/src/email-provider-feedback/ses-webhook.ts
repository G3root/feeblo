import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";

import { EmailProviderFeedbackConfig } from "./config";
import {
  EmailProviderFeedbackDataError,
  EmailProviderFeedbackInputError,
  type ProviderLifecycleEvent,
} from "./schema";
import { EmailProviderFeedbackService } from "./service";
import { toProviderLifecycleEvent } from "./ses-mapping";
import { SesEventNotification, SesSnsEnvelope } from "./ses-schema";

/** The SNS delivery envelope was not recognizable SNS JSON. */
export class SesWebhookEnvelopeError extends Schema.TaggedError<SesWebhookEnvelopeError>()(
  "SesWebhookEnvelopeError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    httpStatus: Schema.optionalKey(Schema.Number),
    message: Schema.String,
    operation: Schema.String,
  }
) {}

/** The SNS subscription confirmation could not be fetched from its SubscribeURL. */
export class SesWebhookConfirmationError extends Schema.TaggedError<SesWebhookConfirmationError>()(
  "SesWebhookConfirmationError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    httpStatus: Schema.optionalKey(Schema.Number),
    message: Schema.String,
    operation: Schema.String,
  }
) {}

/** Outcome of handling one SNS webhook delivery; every path answers SNS with a 2xx. */
export type SesWebhookOutcome =
  | { readonly _tag: "Confirmed" }
  | { readonly _tag: "Ignored" }
  | {
      readonly _tag: "Ingested";
      readonly result:
        | { readonly _tag: "Duplicate" }
        | {
            readonly _tag: "Processed";
            readonly deliveryUpdated: boolean;
            readonly suppressed: boolean;
          }
        | { readonly _tag: "UnknownDelivery" };
    };

const decodeSnsEnvelope = (
  rawBody: string
): Effect.Effect<SesSnsEnvelope, SesWebhookEnvelopeError> =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
    rawBody
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SesWebhookEnvelopeError({
          cause,
          message: "SNS payload is not valid JSON",
          operation: "SesEmailFeedbackWebhook.decodeEnvelope",
        })
    ),
    Effect.flatMap((parsed) =>
      Schema.decodeUnknownEffect(SesSnsEnvelope)(parsed).pipe(
        Effect.mapError(
          (cause) =>
            new SesWebhookEnvelopeError({
              cause,
              message: "SNS envelope does not match a recognized type",
              operation: "SesEmailFeedbackWebhook.decodeEnvelope",
            })
        )
      )
    )
  );

const decodeSesMessage = (message: string): SesEventNotification | undefined =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(Schema.fromJsonString(SesEventNotification))(
      message
    )
  );

const parseSesMessage = (
  message: string
): Effect.Effect<SesEventNotification | undefined, never> =>
  Effect.sync(() => decodeSesMessage(message));

const mapIngestError = (
  cause: unknown
): EmailProviderFeedbackInputError | EmailProviderFeedbackDataError => {
  if (
    cause instanceof EmailProviderFeedbackInputError ||
    cause instanceof EmailProviderFeedbackDataError
  ) {
    return cause;
  }
  return new EmailProviderFeedbackDataError({
    cause,
    message: "Email provider feedback persistence failed",
    operation: "SesEmailFeedbackWebhook.ingest",
    reason: "database",
  });
};

/** Maximum duration of the SNS subscription confirmation GET. */
const SNS_SUBSCRIPTION_CONFIRMATION_TIMEOUT_MS = 10_000;

/**
 * SNS serves certificates and confirmation URLs only from
 * sns.{region}.amazonaws.com and, in the AWS China partition,
 * sns.{region}.amazonaws.com.cn.
 */
const SNS_HTTPS_URL_PATTERN = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

const isSnsHttpsUrl = (value: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" && SNS_HTTPS_URL_PATTERN.test(parsed.hostname)
  );
};

/**
 * Builds the string-to-sign exactly as Amazon SNS signs it for Signature
 * Version 1 and 2: each present field as `Label\nValue`, in the documented
 * order, then `Type\n<type>`. Every value is terminated by a newline,
 * including the final `Type` value.
 */
export const buildSnsStringToSign = (envelope: SesSnsEnvelope): string => {
  const parts: string[] = [];
  const append = (label: string, value: string | undefined) => {
    if (value !== undefined) {
      parts.push(label, value);
    }
  };
  switch (envelope.Type) {
    case "Notification": {
      append("Message", envelope.Message);
      append("MessageId", envelope.MessageId);
      append("Subject", envelope.Subject);
      append("Timestamp", envelope.Timestamp);
      append("TopicArn", envelope.TopicArn);
      break;
    }
    case "SubscriptionConfirmation":
    case "UnsubscribeConfirmation": {
      append("Message", envelope.Message);
      append("MessageId", envelope.MessageId);
      append("SubscribeURL", envelope.SubscribeURL);
      append("Timestamp", envelope.Timestamp);
      append("Token", envelope.Token);
      append("TopicArn", envelope.TopicArn);
      break;
    }
    default:
      return envelope satisfies never;
  }
  parts.push("Type", envelope.Type);
  return `${parts.join("\n")}\n`;
};

const CERTIFICATE_BLOCK =
  /-----BEGIN CERTIFICATE-----\n[\s\S]*?\n-----END CERTIFICATE-----/;

/**
 * Extracts the signer public key from a signing certificate PEM. SNS serves a
 * single certificate on the legacy URL and the signer certificate first in a
 * chain bundle on current URLs.
 */
const publicKeyFromSnsPem = (pem: string): NodeCrypto.KeyObject | undefined => {
  try {
    const signerCert = CERTIFICATE_BLOCK.exec(pem)?.[0] ?? pem;
    return NodeCrypto.createPublicKey({ key: signerCert, format: "pem" });
  } catch {
    return undefined;
  }
};

/** RSA hash algorithm used for each supported SNS SignatureVersion. */
const SNS_SIGNATURE_ALGORITHMS = new Map<string, string>([
  ["1", "sha1"],
  ["2", "sha256"],
]);

const verifySnsSignature = (
  envelope: SesSnsEnvelope,
  publicKey: NodeCrypto.KeyObject
): boolean => {
  if (
    envelope.Signature === undefined ||
    envelope.SignatureVersion === undefined
  ) {
    return false;
  }
  const algorithm = SNS_SIGNATURE_ALGORITHMS.get(envelope.SignatureVersion);
  if (algorithm === undefined) {
    return false;
  }
  try {
    return NodeCrypto.verify(
      algorithm,
      Buffer.from(buildSnsStringToSign(envelope), "utf8"),
      publicKey,
      Buffer.from(envelope.Signature, "base64")
    );
  } catch {
    return false;
  }
};

/** Maximum number of signing-certificate responses cached per webhook instance. */
const SIGNING_CERT_CACHE_MAX_ENTRIES = 8;
/** How long a fetched signing certificate is reused before it is refetched. */
const SIGNING_CERT_CACHE_TTL_MS = 15 * 60 * 1000;

const makeSesEmailFeedbackWebhook = Effect.gen(function* () {
  const feedback = yield* EmailProviderFeedbackService;
  const config = yield* EmailProviderFeedbackConfig;
  const httpClient = yield* HttpClient.HttpClient;

  const signingCertCache = new Map<
    string,
    { readonly expiresAt: number; readonly pem: string }
  >();

  const fetchSnsSigningCert = Effect.fn(
    "SesEmailFeedbackWebhook.fetchSnsSigningCert"
  )((certUrl: string) =>
    Effect.gen(function* () {
      const cached = signingCertCache.get(certUrl);
      if (cached !== undefined && cached.expiresAt > Date.now()) {
        return cached.pem;
      }
      signingCertCache.delete(certUrl);

      // SNS SigningCertURL must be fetched without following redirects —
      // a whitelist-bypass via 302 to an attacker host would leak the fetch
      // to an untrusted endpoint. The server composition root should
      // configure HttpClient with `followRedirects: false`; we defensively
      // reject any 3xx even if the client does follow.
      const response = yield* HttpClient.execute(
        HttpClientRequest.get(certUrl)
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (cause) =>
            new SesWebhookEnvelopeError({
              cause,
              message: "SNS signing certificate request failed",
              operation: "SesEmailFeedbackWebhook.fetchSnsSigningCert",
            })
        ),
        Effect.timeout(SNS_SUBSCRIPTION_CONFIRMATION_TIMEOUT_MS),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new SesWebhookEnvelopeError({
              message: "SNS signing certificate request timed out",
              operation: "SesEmailFeedbackWebhook.fetchSnsSigningCert",
            })
          )
        )
      );
      if (response.status >= 300 && response.status < 400) {
        return yield* new SesWebhookEnvelopeError({
          httpStatus: response.status,
          message: `SNS signing certificate redirected (HTTP ${response.status}) — redirects are not allowed`,
          operation: "SesEmailFeedbackWebhook.fetchSnsSigningCert",
        });
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new SesWebhookEnvelopeError({
          httpStatus: response.status,
          message: `SNS signing certificate returned HTTP ${response.status}`,
          operation: "SesEmailFeedbackWebhook.fetchSnsSigningCert",
        });
      }
      const pem = yield* response.text.pipe(
        Effect.mapError(
          (cause) =>
            new SesWebhookEnvelopeError({
              cause,
              message: "SNS signing certificate response was invalid",
              operation: "SesEmailFeedbackWebhook.fetchSnsSigningCert",
            })
        )
      );

      const now = Date.now();
      if (signingCertCache.size >= SIGNING_CERT_CACHE_MAX_ENTRIES) {
        for (const [url, entry] of signingCertCache) {
          if (entry.expiresAt <= now) {
            signingCertCache.delete(url);
          }
        }
        if (signingCertCache.size >= SIGNING_CERT_CACHE_MAX_ENTRIES) {
          const oldestUrl = signingCertCache.keys().next().value;
          if (oldestUrl !== undefined) {
            signingCertCache.delete(oldestUrl);
          }
        }
      }
      signingCertCache.set(certUrl, {
        expiresAt: now + SIGNING_CERT_CACHE_TTL_MS,
        pem,
      });
      return pem;
    })
  );

  const confirmSubscription = Effect.fn(
    "SesEmailFeedbackWebhook.confirmSubscription"
  )((subscribeUrl: string) =>
    Effect.gen(function* () {
      if (!isSnsHttpsUrl(subscribeUrl)) {
        return yield* new SesWebhookConfirmationError({
          message:
            "SNS subscription confirmation URL is not a trusted HTTPS URL",
          operation: "SesEmailFeedbackWebhook.confirmSubscription",
        });
      }
      // Subscription confirmation must also not follow redirects — an
      // attacker-controlled SubscribeURL would otherwise be fetched.
      const response = yield* HttpClient.execute(
        HttpClientRequest.get(subscribeUrl)
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, httpClient),
        Effect.mapError(
          (cause) =>
            new SesWebhookConfirmationError({
              cause,
              message: "SNS subscription confirmation request failed",
              operation: "SesEmailFeedbackWebhook.confirmSubscription",
            })
        ),
        Effect.timeout(SNS_SUBSCRIPTION_CONFIRMATION_TIMEOUT_MS),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new SesWebhookConfirmationError({
              message: "SNS subscription confirmation request timed out",
              operation: "SesEmailFeedbackWebhook.confirmSubscription",
            })
          )
        )
      );

      if (response.status >= 300 && response.status < 400) {
        return yield* new SesWebhookConfirmationError({
          httpStatus: response.status,
          message: `SNS subscription confirmation redirected (HTTP ${response.status}) — redirects are not allowed`,
          operation: "SesEmailFeedbackWebhook.confirmSubscription",
        });
      }
      if (response.status < 200 || response.status >= 300) {
        return yield* new SesWebhookConfirmationError({
          httpStatus: response.status,
          message: `SNS subscription confirmation returned HTTP ${response.status}`,
          operation: "SesEmailFeedbackWebhook.confirmSubscription",
        });
      }
    })
  );

  const handle = Effect.fn("SesEmailFeedbackWebhook.handle")(function* (
    rawBody: string
  ) {
    const envelope = yield* decodeSnsEnvelope(rawBody);

    const expectedTopicArn = config.expectedTopicArn;
    if (Option.isNone(expectedTopicArn)) {
      // The route is only active when the webhook token is configured, and the
      // signed TopicArn cannot be validated without a known topic. Fail closed
      // rather than trusting an unverifiable source.
      return yield* new SesWebhookEnvelopeError({
        message:
          "SNS topic ARN is not configured; refusing unverifiable feedback",
        operation: "SesEmailFeedbackWebhook.authenticate",
      });
    }
    if (envelope.TopicArn !== expectedTopicArn.value) {
      yield* Effect.logWarning(
        "SNS message topic is not the expected email feedback topic"
      ).pipe(
        Effect.annotateLogs({
          snsMessageId: envelope.MessageId,
          topicArn: envelope.TopicArn,
        })
      );
      return yield* new SesWebhookEnvelopeError({
        message: "SNS topic is not the expected email feedback topic",
        operation: "SesEmailFeedbackWebhook.authenticate",
      });
    }
    if (
      (envelope.SignatureVersion !== "1" &&
        envelope.SignatureVersion !== "2") ||
      envelope.Signature === undefined ||
      envelope.SigningCertURL === undefined
    ) {
      return yield* new SesWebhookEnvelopeError({
        message: "SNS message is missing a verifiable signature",
        operation: "SesEmailFeedbackWebhook.authenticate",
      });
    }
    if (!isSnsHttpsUrl(envelope.SigningCertURL)) {
      return yield* new SesWebhookEnvelopeError({
        message: "SNS signing certificate URL is not a trusted HTTPS URL",
        operation: "SesEmailFeedbackWebhook.authenticate",
      });
    }
    const certPem = yield* fetchSnsSigningCert(envelope.SigningCertURL);
    const publicKey = publicKeyFromSnsPem(certPem);
    if (publicKey === undefined || !verifySnsSignature(envelope, publicKey)) {
      yield* Effect.logWarning(
        "SNS message signature verification failed"
      ).pipe(Effect.annotateLogs({ snsMessageId: envelope.MessageId }));
      return yield* new SesWebhookEnvelopeError({
        message: "SNS message signature verification failed",
        operation: "SesEmailFeedbackWebhook.authenticate",
      });
    }

    switch (envelope.Type) {
      case "SubscriptionConfirmation": {
        if (envelope.SubscribeURL !== undefined) {
          yield* confirmSubscription(envelope.SubscribeURL);
        }
        return { _tag: "Confirmed" as const };
      }
      case "UnsubscribeConfirmation":
        return { _tag: "Ignored" as const };
      case "Notification": {
        const notification = yield* parseSesMessage(envelope.Message);
        if (notification === undefined) {
          yield* Effect.logWarning(
            "SNS notification did not contain a recognized SES event"
          ).pipe(Effect.annotateLogs({ snsMessageId: envelope.MessageId }));
          return { _tag: "Ignored" as const };
        }

        const event: ProviderLifecycleEvent | undefined =
          toProviderLifecycleEvent(envelope.MessageId, notification);
        if (event === undefined) {
          yield* Effect.logWarning(
            "SES event type is not tracked for provider feedback"
          ).pipe(
            Effect.annotateLogs({
              snsMessageId: envelope.MessageId,
              eventType: notification.eventType,
            })
          );
          return { _tag: "Ignored" as const };
        }

        const result = yield* feedback
          .ingest(event)
          .pipe(Effect.mapError(mapIngestError));
        return { _tag: "Ingested" as const, result };
      }
      default:
        return envelope satisfies never;
    }
  });

  return { handle };
});

/** SES event feedback inbound webhook: acknowledges and ingests SNS deliveries. */
export interface SesEmailFeedbackWebhookService {
  readonly handle: (
    rawBody: string
  ) => Effect.Effect<
    SesWebhookOutcome,
    | SesWebhookEnvelopeError
    | SesWebhookConfirmationError
    | EmailProviderFeedbackInputError
    | EmailProviderFeedbackDataError
  >;
}

/** SES event feedback inbound webhook service, owned by the server composition root. */
export class SesEmailFeedbackWebhook extends Context.Service<
  SesEmailFeedbackWebhook,
  SesEmailFeedbackWebhookService
>()("SesEmailFeedbackWebhook", {
  make: makeSesEmailFeedbackWebhook,
}) {
  static readonly layer = Layer.effect(this, this.make);
}
