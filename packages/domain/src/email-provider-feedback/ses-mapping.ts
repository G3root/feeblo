import type { ProviderLifecycleEvent } from "./schema";
import type { SesEventNotification } from "./ses-schema";

const truncate = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : value.slice(0, maxLength);

const parseOccurredAt = (
  timestamp: string | undefined,
  fallback: string | undefined
): Date => {
  const parsed = timestamp === undefined ? undefined : new Date(timestamp);
  if (parsed !== undefined && !Number.isNaN(parsed.getTime())) {
    return parsed;
  }
  const fallbackParsed =
    fallback === undefined ? undefined : new Date(fallback);
  return fallbackParsed !== undefined && !Number.isNaN(fallbackParsed.getTime())
    ? fallbackParsed
    : // Both timestamps invalid (should not happen for AWS payloads); keep the
      // event time valid rather than persisting an Invalid Date.
      new Date();
};

const findMessageId = (notification: SesEventNotification): string => {
  const mail = notification.mail;
  const messageIdHeader = mail.headers
    ?.find((header) => header.name.toLowerCase() === "message-id")
    ?.value.trim();
  const commonHeaderMessageId = mail.commonHeaders?.messageId?.trim();
  // A whitespace-only id must count as absent, not as an empty id, so the
  // lookup falls back to the mail-level messageId for both sources.
  const present = (value: string | undefined): string | undefined =>
    value === undefined || value === "" ? undefined : value;
  return (
    present(messageIdHeader) ?? present(commonHeaderMessageId) ?? mail.messageId
  );
};

/**
 * Normalizes one Amazon SES event notification into Feeblo's provider-neutral
 * lifecycle event. Events that carry no mailing feedback (Send, Open, Click)
 * map to `undefined` so the caller can acknowledge them without work.
 */
export const toProviderLifecycleEvent = (
  eventId: string,
  notification: SesEventNotification
): ProviderLifecycleEvent | undefined => {
  const messageId = findMessageId(notification);
  const mailTimestamp = notification.mail.timestamp;

  switch (notification.eventType) {
    case "Delivery": {
      const smtpResponse = notification.delivery?.smtpResponse?.trim();
      const base = {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(
          notification.delivery?.timestamp,
          mailTimestamp
        ),
        type: "delivered" as const,
      };
      return smtpResponse !== undefined && smtpResponse !== ""
        ? {
            ...base,
            metadata: {
              category: "delivery",
              reasonCode: truncate(smtpResponse, 128),
            },
          }
        : base;
    }
    case "Bounce": {
      const bounce = notification.bounce;
      // AWS cannot classify Undetermined bounces; treat them like hard bounces
      // so a failed delivery never silently stays in flight.
      const bounceType = bounce?.bounceType === "Transient" ? "soft" : "hard";
      const diagnosticCode =
        bounce?.bouncedRecipients?.[0]?.diagnosticCode?.trim();
      const category =
        bounce?.bounceSubType?.trim() ?? bounce?.bounceType ?? "bounce";
      const base: Extract<ProviderLifecycleEvent, { type: "bounced" }> = {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(bounce?.timestamp, mailTimestamp),
        type: "bounced",
        bounceType,
        metadata: { category: truncate(category, 64) },
      };
      return diagnosticCode !== undefined && diagnosticCode !== ""
        ? {
            ...base,
            metadata: {
              ...base.metadata,
              reasonCode: truncate(diagnosticCode, 128),
            },
          }
        : base;
    }
    case "Complaint": {
      const complaint = notification.complaint;
      const category = complaint?.complaintFeedbackType?.trim() ?? "complaint";
      return {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(complaint?.timestamp, mailTimestamp),
        type: "complained",
        metadata: { category: truncate(category, 64) },
      };
    }
    case "DeliveryDelay": {
      const deliveryDelay = notification.deliveryDelay;
      const delayType = deliveryDelay?.delayType?.trim();
      const base = {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(deliveryDelay?.timestamp, mailTimestamp),
        type: "deferred" as const,
      };
      return delayType !== undefined && delayType !== ""
        ? {
            ...base,
            metadata: { category: truncate(delayType, 64) },
          }
        : base;
    }
    case "Reject": {
      const reason = notification.reject?.reason?.trim();
      const base = {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(undefined, mailTimestamp),
        type: "failed" as const,
      };
      return reason !== undefined && reason !== ""
        ? {
            ...base,
            metadata: { category: truncate(reason, 64) },
          }
        : base;
    }
    default:
      return undefined;
  }
};
