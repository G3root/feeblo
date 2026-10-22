import { normalizeEmailAddress } from "@feeblo/domain-contracts/email";

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

const findHeader = (
  notification: SesEventNotification,
  name: string
): string | undefined =>
  notification.mail.headers
    ?.find((header) => header.name.toLowerCase() === name)
    ?.value.trim();

/**
 * The addresses a provider event is about.
 *
 * A bounce names the recipients that failed and a complaint names the ones who
 * reported, which is the set suppression needs. Delivery, delay, reject and
 * open/click events carry no per-address detail, so the envelope destination
 * is the honest fallback. Values are normalized because the suppression and
 * delivery lookups compare addresses exactly.
 */
const findRecipients = (
  notification: SesEventNotification
): readonly string[] => {
  const reported =
    notification.eventType === "Bounce"
      ? (notification.bounce?.bouncedRecipients ?? []).flatMap((recipient) =>
          recipient.emailAddress === undefined ? [] : [recipient.emailAddress]
        )
      : notification.eventType === "Complaint"
        ? (notification.complaint?.complainedRecipients ?? []).flatMap(
            (recipient) =>
              recipient.emailAddress === undefined
                ? []
                : [recipient.emailAddress]
          )
        : notification.eventType === "Delivery"
          ? (notification.delivery?.recipients ?? [])
          : [];
  const fallback = notification.mail.destination ?? [];
  return [
    ...new Set(
      (reported.length > 0 ? reported : fallback).map((email) =>
        normalizeEmailAddress(email)
      )
    ),
  ];
};

/**
 * Normalizes a provider Message-ID for comparison with the stored header.
 *
 * The outbox persists the header exactly as it sends it, angle brackets
 * included. SES repeats the header verbatim in `mail.headers`, but
 * `commonHeaders.messageId` and third-party relays may drop the brackets, so
 * both sides of the lookup are compared in bracket form.
 */
const normalizeProviderMessageId = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
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
  const messageId = normalizeProviderMessageId(findMessageId(notification));
  const mailTimestamp = notification.mail.timestamp;
  const recipients = findRecipients(notification);
  const headerDeliveryId = findHeader(notification, "x-feeblo-delivery-id");
  const deliveryId =
    headerDeliveryId === undefined || headerDeliveryId === ""
      ? undefined
      : headerDeliveryId;

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
        recipients,
        type: "delivered" as const,
        ...(deliveryId !== undefined && { deliveryId }),
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
      // Only `Permanent` is an address fact. `Undetermined` means SES could not
      // classify the bounce, so it is retried; treating it as hard would
      // suppress an address that may still be deliverable.
      const bounceType =
        bounce?.bounceType === "Transient"
          ? "soft"
          : bounce?.bounceType === "Undetermined"
            ? "undetermined"
            : "hard";
      const diagnosticCode =
        bounce?.bouncedRecipients?.[0]?.diagnosticCode?.trim();
      const category =
        bounce?.bounceSubType?.trim() ?? bounce?.bounceType ?? "bounce";
      const base: Extract<ProviderLifecycleEvent, { type: "bounced" }> = {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(bounce?.timestamp, mailTimestamp),
        recipients,
        type: "bounced",
        bounceType,
        metadata: { category: truncate(category, 64) },
        ...(deliveryId !== undefined && { deliveryId }),
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
        recipients,
        type: "complained",
        metadata: { category: truncate(category, 64) },
        ...(deliveryId !== undefined && { deliveryId }),
      };
    }
    case "DeliveryDelay": {
      const deliveryDelay = notification.deliveryDelay;
      const delayType = deliveryDelay?.delayType?.trim();
      const base = {
        eventId,
        messageId,
        occurredAt: parseOccurredAt(deliveryDelay?.timestamp, mailTimestamp),
        recipients,
        type: "deferred" as const,
        ...(deliveryId !== undefined && { deliveryId }),
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
        recipients,
        type: "failed" as const,
        ...(deliveryId !== undefined && { deliveryId }),
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
