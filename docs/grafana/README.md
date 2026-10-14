# Grafana Cloud dashboard

`feeblo-server-dashboard.json` is an importable Grafana dashboard for the queue and email metrics the server exports over OTLP. Traces, trace-derived RED metrics, and logs are covered by Application Observability, Traces Drilldown, and Logs Drilldown; this dashboard is the Prometheus side.

## Import

1. Grafana → **Dashboards** → **New** → **Import**.
2. Upload or paste `feeblo-server-dashboard.json`.
3. When prompted, select your stack's Prometheus data source (`grafanacloud-<org>-prom`).
4. **Import**.

## The service filter

The dashboard filters on `job=~"feeblo/feeblo-server"` by default, because Grafana Cloud builds the `job` label for OTLP metrics from `service.namespace/service.name`. If every panel is empty, open **Explore → Prometheus** and check which service label the series actually carry:

| What the series show | Service label variable | Service variable |
| --- | --- | --- |
| `job="feeblo/feeblo-server"` | `job` | `feeblo/feeblo-server` |
| `service_name="feeblo-server"` | `service_name` | `feeblo-server` |

Both variables are editable in the dashboard toolbar, so no JSON editing is needed.

## What it shows

| Row | Panels |
| --- | --- |
| Integrations | Due and claimed backlog, retry/exhausted outcomes, oldest recovered lease, delivery rate by outcome, p95 latency, lease recoveries and pauses |
| Email outbox | Oldest queued age, delivery retries, throttles, estimated cost, intent/delivery transitions, retries by error tag, access skips, provider submissions, reconciliation recoveries |

## Empty panels

Metrics are exported every 30 seconds, and only by features that ran. An empty panel usually means the feature has seen no traffic, not that the dashboard is broken. If every panel is empty:

1. Confirm the server was deployed with `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` set (see `docs/telemetry.md`).
2. Check the service label as described above.
3. Give it a minute — the first export happens up to 30 seconds after a metric is first touched.
