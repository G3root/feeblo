import type {
  TEmailDeliveryState,
  TEmailIntentKind,
  TEmailOutboxState,
} from "@feeblo/db/validation-schema/email";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

import type { EmailRecipientAccessClass } from "./access";

type EmailDeliveryTransitionLabel = TEmailDeliveryState | "complained";

const emailIntentTransitions = Metric.counter(
  "feeblo_email_intent_transitions_total",
  {
    description: "Email outbox intents entering a lifecycle state",
  }
);

const emailDeliveryTransitions = Metric.counter(
  "feeblo_email_delivery_transitions_total",
  {
    description: "Independent email deliveries entering a lifecycle state",
  }
);

const emailReconciliationRecoveries = Metric.counter(
  "feeblo_email_reconciliation_recoveries_total",
  {
    description: "Email intents or deliveries recovered by reconciliation",
  }
);

const emailDeliveryRetries = Metric.counter(
  "feeblo_email_delivery_retries_total",
  {
    description: "Email delivery retries classified by typed failure",
  }
);

const emailDeliveryThrottles = Metric.counter(
  "feeblo_email_delivery_throttles_total",
  { description: "Email delivery work delayed by an internal safety control" }
);

const emailDeliveryAccessSkips = Metric.counter(
  "feeblo_email_delivery_access_skips_total",
  {
    description:
      "Email deliveries skipped because the recipient lacks organization access",
  }
);

const emailProviderSubmissions = Metric.counter(
  "feeblo_email_provider_submissions_total",
  { description: "Provider-accepted submissions by email intent kind" }
);

const emailEstimatedCostMicros = Metric.counter(
  "feeblo_email_estimated_cost_micros_total",
  {
    description:
      "Estimated provider cost in millionths of the billing currency",
  }
);

const emailOldestQueuedAge = Metric.gauge(
  "feeblo_email_oldest_queued_age_milliseconds",
  { description: "Age of the oldest queued, deferred, or sending delivery" }
);

/**
 * How much of a monthly email allowance is spent, as a share of the limit.
 *
 * A histogram rather than a gauge, because both allowances are reported by
 * every workspace from the same process: a gauge holds one value, so the next
 * send decides it and a workspace sitting at 0.96 is erased when a quiet one
 * reports 0.01 a moment later. A histogram keeps every observation, so the
 * share of sends landing above 0.8 stays alertable however quiet the workspace
 * that reported last happens to be, and `Metric.value(...).max` still answers
 * "how close has a workspace got".
 *
 * Deliberately not tagged with the workspace id: one series per tenant is
 * unbounded cardinality. The `scope` tag separates the two allowances, and the
 * throttle log that fires at a full allowance names the workspace.
 */
export const emailVolumeUsageRatio = Metric.histogram(
  "feeblo_email_volume_usage_ratio",
  {
    description:
      "Share of a monthly accepted-send allowance spent, per send attempt, by scope",
    boundaries: [0.5, 0.8, 0.9, 1],
  }
);

/** Records a low-cardinality outbox lifecycle metric without recipient data. */
export const recordEmailIntentTransition = (
  kind: TEmailIntentKind,
  state: TEmailOutboxState
) =>
  Metric.update(
    Metric.withAttributes(emailIntentTransitions, { kind, state }),
    1
  );

/** Records a low-cardinality delivery lifecycle metric without recipient data. */
export const recordEmailDeliveryTransition = (
  state: EmailDeliveryTransitionLabel,
  count = 1
) =>
  Metric.update(
    Metric.withAttributes(emailDeliveryTransitions, { state }),
    count
  );

/** Records rows recovered by the periodic database reconciliation sweep. */
export const recordEmailReconciliationRecoveries = (count: number) =>
  Metric.update(emailReconciliationRecoveries, count);

/** Records a durable retry without recipient or provider response data. */
export const recordEmailDeliveryRetry = (errorTag: string) =>
  Metric.update(Metric.withAttributes(emailDeliveryRetries, { errorTag }), 1);

/** Records an internal circuit-breaker or volume throttle decision. */
export const recordEmailDeliveryThrottle = (reason: string) =>
  Metric.update(Metric.withAttributes(emailDeliveryThrottles, { reason }), 1);

/** Records a terminal organization-access skip classified by recipient class. */
export const recordEmailDeliveryAccessSkip = (
  recipientClass: EmailRecipientAccessClass
) =>
  Metric.update(
    Metric.withAttributes(emailDeliveryAccessSkips, { recipientClass }),
    1
  );

/** Records one accepted provider submission and its configured cost estimate. */
export const recordEmailProviderSubmission = (
  kind: TEmailIntentKind,
  estimatedCostMicros: number,
  plan: "free" | "paid"
) =>
  Effect.andThen(
    Metric.update(
      Metric.withAttributes(emailProviderSubmissions, { kind, plan }),
      1
    ),
    Metric.update(emailEstimatedCostMicros, estimatedCostMicros)
  );

/** Updates the current oldest queued delivery age gauge. */
export const recordEmailOldestQueuedAge = (ageMilliseconds: number) =>
  Metric.update(emailOldestQueuedAge, Math.max(0, ageMilliseconds));

/**
 * Records how much of a monthly allowance one scope has spent, as a share.
 *
 * A limit of zero or less would divide into infinity, so it reads as fully
 * spent. The caller still owns the decision the number feeds; this observation
 * only has to make the approach visible before the guard trips.
 */
export const recordEmailVolumeUsage = (args: {
  readonly limit: number;
  readonly scope: "platform" | "workspace";
  readonly used: number;
}) =>
  Metric.update(
    Metric.withAttributes(emailVolumeUsageRatio, { scope: args.scope }),
    args.limit <= 0 ? 1 : Math.max(0, args.used) / args.limit
  );
