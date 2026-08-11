/** Stable V1 delivery worker defaults; durations are milliseconds. */
export const integrationDeliveryWorkerDefaults = {
  batchSize: 50,
  connectionConcurrency: 5,
  globalConcurrency: 25,
  leaseDurationMs: 60_000,
  payloadLimitBytes: 256 * 1024,
  pollIntervalMs: 1000,
  requestTimeoutMs: 10_000,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
} as const;
