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
      "Provider-reported bounces by classification, whether they suppressed the address, and whether they were correlated to an outbox delivery",
  }
);

/**
 * Records one bounce event.
 *
 * `undetermined` is the class SES cannot resolve. `correlated` is false for
 * feedback with no delivery row — direct sends (auth, onboarding, invitations)
 * and the rare correlation failure. The rate panels use `correlated="true"`
 * because their denominator, `feeblo_email_provider_submissions_total`, counts
 * outbox submissions only.
 */
export const recordEmailProviderBounce = (
  bounceType: "hard" | "soft" | "undetermined",
  suppressed: boolean,
  correlated: boolean
) =>
  Metric.update(
    Metric.withAttributes(emailProviderBounces, {
      bounceType,
      correlated: correlated ? "true" : "false",
      suppressed: suppressed ? "true" : "false",
    }),
    1
  );

const emailProviderComplaints = Metric.counter(
  "feeblo_email_provider_complaints_total",
  {
    description:
      "Provider-reported spam complaints, split by whether they were correlated to an outbox delivery",
  }
);

/**
 * Records one complaint; the address is suppressed by the same event when it
 * could be scoped to a sender. `correlated` has the same meaning as on the
 * bounce counter.
 */
export const recordEmailProviderComplaint = (correlated: boolean) =>
  Metric.update(
    Metric.withAttributes(emailProviderComplaints, {
      correlated: correlated ? "true" : "false",
    }),
    1
  );
