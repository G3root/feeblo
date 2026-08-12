import type { IntegrationProviderDeliveryFailure } from "./integration-contracts";

/** Retry classification after a provider response or typed provider failure. */
export type IntegrationDeliveryOutcome =
  | { readonly _tag: "Succeeded" }
  | { readonly _tag: "Retry"; readonly retryAfterMs?: number }
  | { readonly _tag: "Terminal" };

const retryableHttpStatuses = new Set([408, 409, 425, 429]);
const retryDelaysMs = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 3_600_000,
  8 * 3_600_000,
  24 * 3_600_000,
] as const;

/** The maximum valid Retry-After honored by the V1 delivery scheduler. */
export const maxIntegrationRetryAfterMs = 24 * 3_600_000;

/** Total attempts include the immediate request plus the six scheduled retries. */
export const maxIntegrationDeliveryAttempts = retryDelaysMs.length + 1;

/** Classifies HTTP response statuses according to the durable delivery contract. */
export const classifyIntegrationHttpDeliveryStatus = (
  httpStatus: number,
  retryAfterMs?: number
): IntegrationDeliveryOutcome => {
  if (httpStatus >= 200 && httpStatus <= 299) {
    return { _tag: "Succeeded" };
  }

  if (
    retryableHttpStatuses.has(httpStatus) ||
    (httpStatus >= 500 && httpStatus <= 599)
  ) {
    return retryAfterMs === undefined
      ? { _tag: "Retry" }
      : { _tag: "Retry", retryAfterMs };
  }

  return { _tag: "Terminal" };
};

/** Classifies typed provider failures without exposing provider-specific implementation details. */
export const classifyIntegrationProviderDeliveryFailure = (
  failure: IntegrationProviderDeliveryFailure
): IntegrationDeliveryOutcome => {
  switch (failure._tag) {
    case "IntegrationProviderRateLimitedError":
      return failure.retryAfterMs === undefined
        ? { _tag: "Retry" }
        : { _tag: "Retry", retryAfterMs: failure.retryAfterMs };
    case "IntegrationProviderTemporaryFailure":
      return { _tag: "Retry" };
    case "IntegrationProviderAuthenticationError":
    case "IntegrationProviderInvalidConfigurationError":
    case "IntegrationProviderPermanentRejection":
    case "IntegrationProviderChannelAlreadyJoinedError":
      return { _tag: "Terminal" };
    default:
      return failure satisfies never;
  }
};

/** Computes a bounded, jittered retry delay after a completed attempt. */
export const computeIntegrationRetryDelayMs = ({
  attemptCount,
  jitterRatio,
  retryAfterMs,
}: {
  readonly attemptCount: number;
  readonly jitterRatio: number;
  readonly retryAfterMs?: number;
}): number | undefined => {
  const baseDelayMs = retryDelaysMs[attemptCount - 1];
  if (baseDelayMs === undefined) {
    return undefined;
  }

  const boundedJitterRatio = Math.min(Math.max(jitterRatio, -0.2), 0.2);
  const jitteredDelayMs = Math.round(baseDelayMs * (1 + boundedJitterRatio));
  const boundedRetryAfterMs =
    retryAfterMs === undefined
      ? 0
      : Math.min(Math.max(retryAfterMs, 0), maxIntegrationRetryAfterMs);

  return Math.max(jitteredDelayMs, boundedRetryAfterMs);
};

/** Converts an outcome into the durable retry/exhaustion decision for one attempt. */
export const decideIntegrationDeliveryRetry = ({
  attemptCount,
  outcome,
  jitterRatio,
}: {
  readonly attemptCount: number;
  readonly outcome: IntegrationDeliveryOutcome;
  readonly jitterRatio: number;
}):
  | { readonly _tag: "Succeeded" }
  | { readonly _tag: "Terminal" }
  | { readonly _tag: "Retry"; readonly delayMs: number }
  | { readonly _tag: "Exhausted" } => {
  if (outcome._tag === "Succeeded" || outcome._tag === "Terminal") {
    return outcome;
  }

  const delayMs = computeIntegrationRetryDelayMs({
    attemptCount,
    jitterRatio,
    ...(outcome.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: outcome.retryAfterMs }),
  });
  return delayMs === undefined
    ? { _tag: "Exhausted" }
    : { _tag: "Retry", delayMs };
};
