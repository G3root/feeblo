import * as Metric from "effect/Metric";
import type { EmailDeliveryState, EmailIntentKind, EmailOutboxState } from "./schema";

const emailIntentTransitions = Metric.counter("feeblo_email_intent_transitions_total", {
  description: "Email outbox intents entering a lifecycle state",
});

const emailDeliveryTransitions = Metric.counter("feeblo_email_delivery_transitions_total", {
  description: "Independent email deliveries entering a lifecycle state",
});

const emailReconciliationRecoveries = Metric.counter("feeblo_email_reconciliation_recoveries_total", {
  description: "Email intents or deliveries recovered by reconciliation",
});

/** Records a low-cardinality outbox lifecycle metric without recipient data. */
export const recordEmailIntentTransition = (
  kind: EmailIntentKind,
  state: EmailOutboxState
) => Metric.update(Metric.withAttributes(emailIntentTransitions, { kind, state }), 1);

/** Records a low-cardinality delivery lifecycle metric without recipient data. */
export const recordEmailDeliveryTransition = (
  state: EmailDeliveryState,
  count = 1
) => Metric.update(Metric.withAttributes(emailDeliveryTransitions, { state }), count);

/** Records rows recovered by the periodic database reconciliation sweep. */
export const recordEmailReconciliationRecoveries = (count: number) =>
  Metric.update(emailReconciliationRecoveries, count);
