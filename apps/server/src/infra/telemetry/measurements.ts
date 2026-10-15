/**
 * Low-cardinality transport measurements for the OTLP exporters.
 *
 * A collector that refuses or times out an export is otherwise invisible: the
 * exporter's own retry policy logs at debug, and the batch is dropped. These
 * counters and the warning log keep export health observable without a second
 * backend, and `recordExportFailure` never records a collector's response body.
 */
import * as Effect from "effect/Effect";
import * as Metric from "effect/Metric";

const exportFailures = Metric.counter(
  "feeblo_telemetry_export_failures_total",
  {
    description: "OTLP exports the collector refused, dropped, or timed out",
  }
);

const rejectedRecords = Metric.counter(
  "feeblo_telemetry_rejected_records_total",
  {
    description:
      "Records the collector rejected in a partial-success acknowledgement",
  }
);

/** The signal an export path belongs to; the endpoint path is the only input. */
const signalOf = (path: string): string =>
  path.endsWith("/traces")
    ? "traces"
    : path.endsWith("/logs")
      ? "logs"
      : path.endsWith("/metrics")
        ? "metrics"
        : "other";

/** Record one export failure on the metrics registry and the local log. */
export const recordExportFailure = (
  path: string,
  reason:
    | "transport"
    | "interrupted"
    | "partial-success"
    | "acknowledgement"
    | "timeout",
  records = 0
): Effect.Effect<void> => {
  const signal = signalOf(path);
  return Metric.update(
    Metric.withAttributes(exportFailures, { signal, reason }),
    1
  ).pipe(
    Effect.andThen(
      Metric.update(
        Metric.withAttributes(rejectedRecords, { signal, reason }),
        records
      )
    ),
    Effect.andThen(
      Effect.logWarning("Telemetry export failed").pipe(
        Effect.annotateLogs({
          "feeblo.telemetry.signal": signal,
          "feeblo.telemetry.failure": reason,
          "feeblo.telemetry.rejected_records": records,
        })
      )
    )
  );
};
