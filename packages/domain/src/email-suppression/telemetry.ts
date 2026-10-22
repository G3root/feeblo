import * as Metric from "effect/Metric";

import type { EmailSuppressionReason } from "./repository";

/** How the address reached the list, for a per-source dashboard split. */
export type EmailSuppressionSource = "provider" | "smtp" | "manual";

const emailSuppressionsWritten = Metric.counter(
  "feeblo_email_suppressions_written_total",
  {
    description:
      "Addresses added to a suppression list, by reason and how they were observed",
  }
);

/** Records one suppression write; repeated writes to the same row also count. */
export const recordEmailSuppression = (
  reason: EmailSuppressionReason,
  source: EmailSuppressionSource
) =>
  Metric.update(
    Metric.withAttributes(emailSuppressionsWritten, { reason, source }),
    1
  );

const emailProviderBounces = Metric.counter(
  "feeblo_email_provider_bounces_total",
  {
    description:
      "Provider-reported bounces by classification, and whether they suppressed the address",
  }
);

/** Records one bounce event. `undetermined` is the class SES cannot resolve. */
export const recordEmailProviderBounce = (
  bounceType: "hard" | "soft" | "undetermined",
  suppressed: boolean
) =>
  Metric.update(
    Metric.withAttributes(emailProviderBounces, {
      bounceType,
      suppressed: suppressed ? "true" : "false",
    }),
    1
  );

const emailProviderComplaints = Metric.counter(
  "feeblo_email_provider_complaints_total",
  { description: "Provider-reported spam complaints" }
);

/** Records one complaint; the address is suppressed by the same event. */
export const recordEmailProviderComplaint = Metric.update(
  emailProviderComplaints,
  1
);
