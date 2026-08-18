import { describe, expect, it } from "@effect/vitest";

import { toProviderLifecycleEvent } from "./ses-mapping";
import type { SesEventNotification } from "./ses-schema";

const deliveryNotification = (
  overrides: Partial<SesEventNotification> = {}
): SesEventNotification => ({
  eventType: "Delivery",
  mail: {
    timestamp: "2026-08-18T00:00:00.000Z",
    messageId: "01000178a3125d21-000000",
    source: "noreply@feeblo.com",
    destination: ["feedback@example.com"],
    headers: [
      {
        name: "Message-ID",
        value: "<email.hash@notifications.feeblo>",
      },
    ],
    commonHeaders: {
      messageId: "<email.hash@notifications.feeblo>",
    },
  },
  delivery: {
    timestamp: "2026-08-18T00:00:02.000Z",
    smtpResponse: "250 2.6.0 Message received",
    recipients: ["feedback@example.com"],
  },
  ...overrides,
});

describe("toProviderLifecycleEvent", () => {
  it("maps a delivery event to a delivered lifecycle event", () => {
    expect(
      toProviderLifecycleEvent("sns-delivery-1", deliveryNotification())
    ).toMatchObject({
      eventId: "sns-delivery-1",
      messageId: "<email.hash@notifications.feeblo>",
      occurredAt: new Date("2026-08-18T00:00:02.000Z"),
      type: "delivered",
      metadata: {
        category: "delivery",
        reasonCode: "250 2.6.0 Message received",
      },
    });
  });

  it("prefers the original Message-ID header over SES-assigned ids", () => {
    const notification = deliveryNotification({
      mail: {
        ...deliveryNotification().mail,
        messageId: "01000178a3125d21-000000",
        commonHeaders: {
          messageId: " a-custom-message-id",
        },
        headers: [
          {
            name: "message-id",
            value: "<email.custom@notifications.feeblo>",
          },
        ],
      },
    });
    expect(
      toProviderLifecycleEvent("sns-delivery-2", notification)?.messageId
    ).toBe("<email.custom@notifications.feeblo>");
  });

  it("falls back to SES-assigned ids when no Message-ID header is present", () => {
    const mail = deliveryNotification().mail;
    const notification = deliveryNotification({
      mail: { timestamp: mail.timestamp, messageId: mail.messageId },
    });
    expect(
      toProviderLifecycleEvent("sns-delivery-3", notification)?.messageId
    ).toBe("01000178a3125d21-000000");
  });

  it("treats a whitespace-only Message-ID header as absent", () => {
    const notification = deliveryNotification({
      mail: {
        ...deliveryNotification().mail,
        headers: [{ name: "Message-ID", value: "   " }],
        commonHeaders: {
          messageId: "<email.fallback@notifications.feeblo>",
        },
      },
    });
    expect(
      toProviderLifecycleEvent("sns-delivery-4", notification)?.messageId
    ).toBe("<email.fallback@notifications.feeblo>");

    const withoutCommonHeaders = deliveryNotification({
      mail: {
        ...deliveryNotification().mail,
        headers: [{ name: "Message-ID", value: " " }],
        commonHeaders: {},
      },
    });
    expect(
      toProviderLifecycleEvent("sns-delivery-5", withoutCommonHeaders)
        ?.messageId
    ).toBe("01000178a3125d21-000000");
  });

  it("treats a whitespace-only commonHeaders messageId as absent", () => {
    const notification = deliveryNotification({
      mail: {
        ...deliveryNotification().mail,
        headers: [],
        commonHeaders: { messageId: "   " },
      },
    });
    expect(
      toProviderLifecycleEvent("sns-delivery-7", notification)?.messageId
    ).toBe("01000178a3125d21-000000");
  });

  it("maps a permanent bounce to a hard bounce lifecycle event", () => {
    const notification: SesEventNotification = {
      eventType: "Bounce",
      mail: deliveryNotification().mail,
      bounce: {
        bounceType: "Permanent",
        bounceSubType: "General",
        timestamp: "2026-08-18T00:00:01.000Z",
        bouncedRecipients: [
          {
            emailAddress: "feedback@example.com",
            action: "failed",
            status: "5.1.1",
            diagnosticCode: "smtp; 550 5.1.1 user unknown",
          },
        ],
      },
    };
    expect(
      toProviderLifecycleEvent("sns-bounce-1", notification)
    ).toMatchObject({
      eventId: "sns-bounce-1",
      type: "bounced",
      bounceType: "hard",
      metadata: {
        category: "General",
        reasonCode: "smtp; 550 5.1.1 user unknown",
      },
    });
  });

  it("maps a transient bounce to a soft bounce lifecycle event", () => {
    const notification: SesEventNotification = {
      eventType: "Bounce",
      mail: deliveryNotification().mail,
      bounce: {
        bounceType: "Transient",
        bounceSubType: "MailboxFull",
        timestamp: "2026-08-18T00:00:01.000Z",
      },
    };
    expect(
      toProviderLifecycleEvent("sns-bounce-2", notification)
    ).toMatchObject({ type: "bounced", bounceType: "soft" });
  });

  it("maps a delivery delay to a deferred lifecycle event", () => {
    const notification: SesEventNotification = {
      eventType: "DeliveryDelay",
      mail: deliveryNotification().mail,
      deliveryDelay: {
        delayType: "Redirection",
        smtpResponse: "450 4.2.0 Message deferred",
        reportingMTA: "dsn.amazonaws.com",
        timestamp: "2026-08-18T00:00:03.000Z",
      },
    };
    expect(toProviderLifecycleEvent("sns-delay-1", notification)).toMatchObject(
      {
        eventId: "sns-delay-1",
        messageId: "<email.hash@notifications.feeblo>",
        occurredAt: new Date("2026-08-18T00:00:03.000Z"),
        type: "deferred",
        metadata: { category: "Redirection" },
      }
    );
  });

  it("returns undefined for subscription events", () => {
    const notification: SesEventNotification = {
      eventType: "Subscription",
      mail: deliveryNotification().mail,
    };
    expect(
      toProviderLifecycleEvent("sns-subscription-1", notification)
    ).toBeUndefined();
  });

  it("falls back to the mail timestamp when the event timestamp is invalid", () => {
    const notification = deliveryNotification({
      delivery: {
        ...deliveryNotification().delivery,
        timestamp: "not-a-date",
      },
    });
    expect(
      toProviderLifecycleEvent("sns-delivery-6", notification)
    ).toMatchObject({
      type: "delivered",
      occurredAt: new Date("2026-08-18T00:00:00.000Z"),
    });
  });

  it("keeps a valid event time when all timestamps are invalid", () => {
    const before = new Date();
    const notification: SesEventNotification = {
      eventType: "Reject",
      mail: { ...deliveryNotification().mail, timestamp: "not-a-date" },
      reject: { reason: "Bad content" },
    };
    const event = toProviderLifecycleEvent("sns-reject-2", notification);
    expect(event).toBeDefined();
    const occurredAt = event?.occurredAt;
    expect(occurredAt).toBeInstanceOf(Date);
    // SAFETY: the assertion above confirms occurredAt is a valid Date.
    const occurredAtDate = occurredAt as Date;
    expect(Number.isNaN(occurredAtDate.getTime())).toBe(false);
    expect(occurredAtDate.getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 100
    );
    expect(occurredAtDate.getTime()).toBeLessThanOrEqual(Date.now() + 100);
  });

  it("maps an undetermined bounce to a hard bounce lifecycle event", () => {
    const notification: SesEventNotification = {
      eventType: "Bounce",
      mail: deliveryNotification().mail,
      bounce: {
        bounceType: "Undetermined",
        bounceSubType: "Undefined",
        timestamp: "2026-08-18T00:00:01.000Z",
      },
    };
    expect(
      toProviderLifecycleEvent("sns-bounce-3", notification)
    ).toMatchObject({ type: "bounced", bounceType: "hard" });
  });

  it("maps a complaint to a complained lifecycle event", () => {
    const notification: SesEventNotification = {
      eventType: "Complaint",
      mail: deliveryNotification().mail,
      complaint: {
        timestamp: "2026-08-18T00:00:01.000Z",
        complaintFeedbackType: "abuse",
        complainedRecipients: [{ emailAddress: "feedback@example.com" }],
      },
    };
    expect(
      toProviderLifecycleEvent("sns-complaint-1", notification)
    ).toMatchObject({
      eventId: "sns-complaint-1",
      type: "complained",
      metadata: { category: "abuse" },
    });
  });

  it("maps a reject event to a failed lifecycle event", () => {
    const notification: SesEventNotification = {
      eventType: "Reject",
      mail: deliveryNotification().mail,
      reject: { reason: "Bad content" },
    };
    expect(
      toProviderLifecycleEvent("sns-reject-1", notification)
    ).toMatchObject({
      eventId: "sns-reject-1",
      type: "failed",
      metadata: { category: "Bad content" },
    });
  });

  it("returns undefined for send, open and click events", () => {
    for (const eventType of ["Send", "Open", "Click"] as const) {
      expect(
        toProviderLifecycleEvent("sns-noop-1", {
          eventType,
          mail: deliveryNotification().mail,
        })
      ).toBeUndefined();
    }
  });
});
