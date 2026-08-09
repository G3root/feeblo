import * as Effect from "effect/Effect";
import * as React from "react";
import { describe, expect, it } from "vitest";

import {
  Mailer,
  type MailerTransport,
  makeMailerLayer,
  MailPermanentDeliveryError,
  MailTemporaryDeliveryError,
  MailUncertainDeliveryError,
} from "./mailer";

const messageId = "<delivery_123@notifications.feeblo>";

const message = {
  to: "recipient@example.com",
  subject: "A safe subject",
  react: React.createElement("div", undefined, "A rendered test email"),
  messageId,
} as const;

const sendWith = (transport: MailerTransport) =>
  Effect.gen(function* () {
    const mailer = yield* Mailer;
    return yield* mailer.send(message);
  }).pipe(Effect.provide(makeMailerLayer(transport)));

describe("Mailer", () => {
  it("returns the supplied deterministic message ID with bounded safe metadata", async () => {
    const sent = await Effect.runPromise(
      sendWith({
        send: () =>
          Effect.succeed({
            acceptedRecipientCount: 1,
            messageId: "<provider_456@notifications.feeblo>",
            providerMessageId: "cf_123",
            rejectedRecipientCount: 0,
            responseCode: 250,
          }),
      })
    );

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
  });

  it("does not expose transport recipients or raw provider responses", async () => {
    const sent = await Effect.runPromise(
      sendWith({
        send: () =>
          Effect.succeed({
            acceptedRecipientCount: 0,
            messageId,
            rejectedRecipientCount: 1,
            responseCode: 550,
          }),
      })
    );

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
  });

  it("preserves temporary transport failures as typed retryable failures", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        sendWith({
          send: () =>
            Effect.fail(
              new MailTemporaryDeliveryError({ smtpStatusCode: 451 })
            ),
        })
      )
    );

    expect(failure).toBeInstanceOf(MailTemporaryDeliveryError);
  });

  it("preserves permanent transport failures as terminal failures", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        sendWith({
          send: () =>
            Effect.fail(
              new MailPermanentDeliveryError({ smtpStatusCode: 550 })
            ),
        })
      )
    );

    expect(failure).toBeInstanceOf(MailPermanentDeliveryError);
  });

  it("preserves uncertain transport failures for at-least-once retry", async () => {
    const failure = await Effect.runPromise(
      Effect.flip(
        sendWith({
          send: () => Effect.fail(new MailUncertainDeliveryError({})),
        })
      )
    );

    expect(failure).toBeInstanceOf(MailUncertainDeliveryError);
  });
});
