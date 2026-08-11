import type {
  TEmailDeliveryState,
  TEmailIntentKind,
  TEmailOutboxState,
} from "@feeblo/db/validation-schema/email";
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

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
