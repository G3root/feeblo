import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as React from "react";

import {
  Mailer,
  type MailMessage,
  type MailerTransport,
  MailPermanentDeliveryError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
  makeMailerLayer,
} from "./mailer";

const messageId = "<delivery_123@notifications.feeblo>";

const message = {
  to: "recipient@example.com",
  subject: "A safe subject",
  react: React.createElement("div", undefined, "A rendered test email"),
  messageId,
} as const;

const transportReceipt = {
  acceptedRecipientCount: 1,
  messageId: "<provider_456@notifications.feeblo>",
  rejectedRecipientCount: 0,
} as const;

const sendWith = (
  transport: MailerTransport,
  sentMessage: MailMessage = message
) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    return yield* mailer.send(sentMessage);
  }).pipe(Effect.provide(makeMailerLayer(transport)));

describe("Mailer", () => {
  it.effect(
    "returns the supplied deterministic message ID with bounded safe metadata",
    () =>
      Effect.gen(function* () {
        const sent = yield* sendWith({
          send: () =>
            Effect.succeed({
              acceptedRecipientCount: 1,
              messageId: "<provider_456@notifications.feeblo>",
              providerMessageId: "cf_123",
              rejectedRecipientCount: 0,
              responseCode: 250,
            }),
        });

        expect(sent).toEqual({
          accepted: true,
          messageId,
          providerMetadata: {
            acceptedRecipientCount: 1,
            providerMessageId: "cf_123",
            rejectedRecipientCount: 0,
            responseCode: 250,
          },
        });
      })
  );

  it.effect(
    "does not expose transport recipients or raw provider responses",
    () =>
      Effect.gen(function* () {
        const sent = yield* sendWith({
          send: () =>
            Effect.succeed({
              acceptedRecipientCount: 0,
              messageId,
              rejectedRecipientCount: 1,
              responseCode: 550,
            }),
        });

        expect(sent).toEqual({
          accepted: false,
          messageId,
          providerMetadata: {
            acceptedRecipientCount: 0,
            rejectedRecipientCount: 1,
            responseCode: 550,
          },
        });
        expect(Object.keys(sent.providerMetadata)).not.toContain("response");
        expect(Object.keys(sent.providerMetadata)).not.toContain("recipient");
      })
  );

  it.effect(
    "adds a unique X-Entity-Ref-ID header to every send so Outlook does not thread emails",
    () =>
      Effect.gen(function* () {
        const entityRefIds: string[] = [];
        const transport: MailerTransport = {
          send: (rendered) =>
            Effect.sync(() => {
              const entityRefId = rendered.headers?.["X-Entity-Ref-ID"];
              if (entityRefId !== undefined) {
                entityRefIds.push(entityRefId);
              }
              return transportReceipt;
            }),
        };

        yield* sendWith(transport);
        yield* sendWith(transport);

        expect(entityRefIds).toHaveLength(2);
        expect(entityRefIds[0]).toBeTruthy();
        expect(entityRefIds[1]).not.toBe(entityRefIds[0]);
      })
  );

  it.effect(
    "lets caller-supplied headers override the default X-Entity-Ref-ID",
    () =>
      Effect.gen(function* () {
        let capturedHeaders: Readonly<Record<string, string>> | undefined;
        yield* sendWith(
          {
            send: (rendered) =>
              Effect.sync(() => {
                capturedHeaders = rendered.headers;
                return transportReceipt;
              }),
          },
          {
            ...message,
            headers: { "X-Entity-Ref-ID": "caller-supplied" },
          }
        );

        expect(capturedHeaders?.["X-Entity-Ref-ID"]).toBe("caller-supplied");
      })
  );

  it.effect(
    "treats the X-Entity-Ref-ID header name case-insensitively when callers override it",
    () =>
      Effect.gen(function* () {
        let capturedHeaders: Readonly<Record<string, string>> | undefined;
        yield* sendWith(
          {
            send: (rendered) =>
              Effect.sync(() => {
                capturedHeaders = rendered.headers;
                return transportReceipt;
              }),
          },
          {
            ...message,
            headers: { "x-entity-ref-id": "caller-supplied-lowercase" },
          }
        );

        expect(capturedHeaders?.["x-entity-ref-id"]).toBe(
          "caller-supplied-lowercase"
        );
        expect(Object.keys(capturedHeaders ?? {})).toEqual([
          "x-entity-ref-id",
        ]);
      })
  );

  it.effect(
    "preserves temporary transport failures as typed retryable failures",
    () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          sendWith({
            send: () =>
              Effect.fail(
                new MailTemporaryDeliveryError({
                  message: "SMTP provider temporarily rejected the message",
                  operation: "MailerTransport.send",
                  provider: "smtp",
                  smtpStatusCode: 451,
                })
              ),
          })
        );

        expect(failure).toBeInstanceOf(MailTemporaryDeliveryError);
      })
  );

  it.effect("preserves permanent transport failures as terminal failures", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        sendWith({
          send: () =>
            Effect.fail(
              new MailPermanentDeliveryError({
                message: "SMTP provider permanently rejected the message",
                operation: "MailerTransport.send",
                provider: "smtp",
                smtpStatusCode: 550,
              })
            ),
        })
      );

      expect(failure).toBeInstanceOf(MailPermanentDeliveryError);
    })
  );

  it.effect(
    "preserves uncertain transport failures for caller-side terminal handling",
    () =>
      Effect.gen(function* () {
        const failure = yield* Effect.flip(
          sendWith({
            send: () =>
              Effect.fail(
                new MailUncertainDeliveryError({
                  message: "SMTP provider returned an uncertain result",
                  operation: "MailerTransport.send",
                  provider: "smtp",
                })
              ),
          })
        );

        expect(failure).toBeInstanceOf(MailUncertainDeliveryError);
      })
  );
});
