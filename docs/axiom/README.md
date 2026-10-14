# Axiom

How to point the server's OTLP telemetry at [Axiom](https://axiom.co) instead of Grafana Cloud. The exporters speak standard OTLP, so this is a configuration change; the server was built with Axiom-compatible choices (explicit-bucket histograms, per-signal headers, `service.instance.id`).

## Setup

1. Create two **Events** datasets (one for traces, one for logs) and one **Metrics** dataset in Axiom. Axiom requires a dedicated dataset per signal.
2. Create an API token with ingest permission for those datasets.
3. Set the environment:

```
OTEL_EXPORTER_OTLP_ENDPOINT=https://<your-axiom-domain>
OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Bearer <token>,x-axiom-dataset=<traces-dataset>
OTEL_EXPORTER_OTLP_LOGS_HEADERS=Authorization=Bearer <token>,x-axiom-dataset=<logs-dataset>
OTEL_EXPORTER_OTLP_METRICS_HEADERS=Authorization=Bearer <token>,x-axiom-metrics-dataset=<metrics-dataset>
OTEL_SERVICE_NAME=feeblo-server
OTEL_RESOURCE_ATTRIBUTES=service.namespace=feeblo
APP_ENV=production
```

Details that matter:

- The endpoint is the bare domain: the server appends `/v1/traces`, `/v1/logs`, and `/v1/metrics` itself.
- Traces and logs use the `x-axiom-dataset` header; metrics use `x-axiom-metrics-dataset`. Per-signal `_HEADERS` **replace** the base headers instead of merging, so every line repeats the token.
- The token is a bearer token, not Basic auth.

## What differs from Grafana Cloud

| Concern | Grafana Cloud | Axiom |
| --- | --- | --- |
| Query language | PromQL / TraceQL / LogQL | MPL for metrics, APL for logs and traces |
| Metric names | rewritten for Prometheus (`_ratio` on unitless gauges, `job` built from `service.namespace/service.name`) | kept as exported; resource, scope, and metric attributes share one tag namespace |
| Dashboards | import `docs/grafana/*.json` | build from `mpl-panels.md`; Grafana JSON does not import |
| APM | Application Observability derives RED from traces | trace queries over the traces dataset; the server's HTTP metrics give exact RED |
| Histograms | explicit buckets become classic `_bucket` series | query with `interpolate_cumulative_histogram` |

MetricsDB does not accept OTLP **exponential** histograms. Effect exports explicit-bucket histograms (`explicitBounds`) for every `Metric.histogram`, so all metrics in this repo are accepted. Timestamps are truncated to seconds, which is finer than the 30-second metrics export interval.

## Dashboards and monitors

`mpl-panels.md` has one query per panel for the same panels as the Grafana dashboards. Paste each into an Axiom dashboard element and choose the visualization; set the dataset placeholder to your metrics dataset.

For monitors, start from the same queries:

- due integration delivery backlog above zero for 10 minutes;
- oldest queued email age above five minutes;
- any `exhausted` integration delivery;
- HTTP 5xx ratio above a few percent.
