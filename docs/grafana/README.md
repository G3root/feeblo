# Grafana Cloud dashboards

Two importable Grafana dashboards for the telemetry the server exports over OTLP:

| File | Covers |
| --- | --- |
| `feeblo-server-apm.json` | Exact HTTP request rate, error rate, and latency, from the server's own metrics |
| `feeblo-server-dashboard.json` | Integration delivery and email outbox queues, from the server's own metrics |

Traces, trace-derived RED metrics, and logs are covered by Application Observability, Traces Drilldown, and Logs Drilldown instead.

## Import

1. Grafana → **Dashboards** → **New** → **Import**.
2. Upload or paste a dashboard file.
3. When prompted, select your stack's Prometheus data source (`grafanacloud-<org>-prom`).
4. **Import**.

## The service filter

Both dashboards filter on `job=~"feeblo/feeblo-server"` by default, because Grafana Cloud builds the `job` label for OTLP metrics from `service.namespace/service.name`. If every panel is empty, open **Explore → Prometheus** and check which service label the series actually carry:

| What the series show | Service label variable | Service variable |
| --- | --- | --- |
| `job="feeblo/feeblo-server"` | `job` | `feeblo/feeblo-server` |
| `service_name="feeblo-server"` | `service_name` | `feeblo-server` |

Both variables are editable in the dashboard toolbar, so no JSON editing is needed.

## HTTP APM

`feeblo-server-apm.json` is built from two metrics recorded by the HTTP metrics middleware:

| Metric | Labels |
| --- | --- |
| `feeblo_http_server_requests_total` | `method`, `route`, `status` |
| `feeblo_http_server_request_duration_milliseconds` (classic histogram) | `method`, `route` |

They are recorded for every response the server sends — successful, failed, or unmatched — so the values are exact and do not depend on trace sampling. The `route` label is the request path with UUID, legid, and known token segments redacted to `:id`; unmatched paths (404s) collapse to `unmatched` so scanner traffic cannot mint a label per path.

RPC methods are not visible here: every call shares `POST /rpc`, and the method only exists on the span. Use Application Observability or Traces Drilldown for the per-method breakdown.

## Queue and email dashboards

`feeblo-server-dashboard.json` shows:

| Row | Panels |
| --- | --- |
| Integrations | Due and claimed backlog, retry/exhausted outcomes, oldest recovered lease, delivery rate by outcome, p95 latency, lease recoveries and pauses |
| Email outbox | Oldest queued age, delivery retries, throttles, estimated cost, intent/delivery transitions, retries by error tag, access skips, provider submissions, reconciliation recoveries |

## Gauge names carry a `_ratio` suffix

Grafana Cloud's OTLP-to-Prometheus conversion appends suffixes following the OpenTelemetry spec. The queue dashboard's gauges do not set an explicit OTel unit, so they export as unit `1` and land as `<name>_ratio` — for example `feeblo_integration_delivery_backlog_ratio`. Counters already end in `_total` and keep their name; the latency histogram is unaffected. To list exactly what your stack stores:

```promql
{__name__=~"feeblo_.*"}
```

## Empty panels

Metrics are exported every 30 seconds, and only by features that ran. An empty panel usually means the feature has seen no traffic, not that the dashboard is broken. If every panel is empty:

1. Confirm the server was deployed with `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` set (see `docs/telemetry.md`).
2. Check the service label as described above.
3. Give it a minute — the first export happens up to 30 seconds after a metric is first touched.
