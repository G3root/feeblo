import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

/** Counter of delivery attempts by durable outcome and error tag. */
const deliveryTransitions = Metric.counter(
  "feeblo_integration_delivery_transitions_total",
  { description: "Integration delivery attempts by durable outcome" }
);

const deliveryLatency = Metric.histogram(
  "feeblo_integration_delivery_latency_milliseconds",
  {
    boundaries: Metric.exponentialBoundaries({
      start: 10,
      factor: 2,
      count: 12,
    }),
    description: "End-to-end provider request latency in milliseconds",
  }
);

const claimedBacklog = Metric.gauge("feeblo_integration_claimed_backlog", {
  description: "Deliveries claimed by the latest worker poll",
});

const deliveryBacklog = Metric.gauge("feeblo_integration_delivery_backlog", {
  description: "Due integration deliveries waiting to be claimed",
});

const oldestRecoveredLeaseAge = Metric.gauge(
  "feeblo_integration_oldest_recovered_lease_age_milliseconds",
  { description: "Age of the oldest lease recovered by the latest worker poll" }
);

const leaseRecoveries = Metric.counter(
  "feeblo_integration_lease_recoveries_total",
  {
    description:
      "Expired integration delivery leases recovered after interruption",
  }
);

const automaticPauses = Metric.counter(
  "feeblo_integration_automatic_pauses_total",
  { description: "Connections paused after consecutive exhausted deliveries" }
);

/** Records one finished delivery attempt by outcome and error tag. */
export const recordIntegrationDeliveryOutcome = (
  outcome: "succeeded" | "retry" | "exhausted",
  durationMs: number,
  errorTag = "none"
) =>
  Effect.andThen(
    Metric.update(
      Metric.withAttributes(deliveryTransitions, { errorTag, outcome }),
      1
    ),
    Metric.update(
      Metric.withAttributes(deliveryLatency, { outcome }),
      Math.max(0, durationMs)
    )
  );

/** Records the number of deliveries claimed by the latest worker poll. */
export const recordIntegrationClaimedBacklog = (count: number) =>
  Metric.update(claimedBacklog, count);

/** Records the number of due deliveries waiting to be claimed. */
export const recordIntegrationDeliveryBacklog = (count: number) =>
  Metric.update(deliveryBacklog, count);

/** Records the age of the oldest lease recovered by the latest worker poll. */
export const recordIntegrationRecoveredLeaseAge = (ageMs: number) =>
  Metric.update(oldestRecoveredLeaseAge, Math.max(0, ageMs));

/** Counts expired integration delivery leases recovered after interruption. */
export const recordIntegrationLeaseRecoveries = (count: number) =>
  Metric.update(leaseRecoveries, count);

/** Counts connections paused after consecutive exhausted deliveries. */
export const recordIntegrationAutomaticPause = () =>
  Metric.update(automaticPauses, 1);
