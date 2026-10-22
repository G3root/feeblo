# Grafana Cloud dashboards

Three importable Grafana dashboards for the telemetry the server exports over OTLP:

| File | Covers |
| --- | --- |
| `feeblo-server-apm.json` | Exact HTTP request rate, error rate, and latency, from the server's own metrics |
| `feeblo-server-dashboard.json` | Integration delivery, email outbox queues, and email deliverability, from the server's own metrics |
| `feeblo-server-runtime.json` | Telemetry export health and process CPU, memory, and event-loop metrics |

Traces, trace-derived RED metrics, and logs are covered by Application Observability, Traces Drilldown, and Logs Drilldown instead.

## Import

1. Grafana → **Dashboards** → **New** → **Import**.
2. Upload or paste a dashboard file.
3. When prompted, select your stack's Prometheus data source (`grafanacloud-<org>-prom`).
4. **Import**.

## The service filter

All three dashboards filter on `job=~"feeblo/feeblo-server"` by default, because Grafana Cloud builds the `job` label for OTLP metrics from `service.namespace/service.name`. If every panel is empty, open **Explore → Prometheus** and check which service label the series actually carry:

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

They are recorded for every response the server sends — successful, failed, or unmatched — so the values are exact and do not depend on trace sampling. The `route` label is the router's matched route template (for example `/api/v1/posts/:postId`), so a matched handler that answers 404 keeps its route; only genuinely unmatched paths collapse to `unmatched`, which stops scanner traffic from minting a label per path.

The SLO row turns those exact metrics into objectives. It assumes **1% of requests may be 5xx** and **p95 latency must stay under 500 ms** (p99 under 1000 ms), and derives fast (1h) and slow (6h) error-budget burn rates from the first. Those are the chosen defaults, not a measurement; if the product targets differ, change them in the panel queries, the panel thresholds, and the alert rules below. The dashboard description repeats the objectives so they are visible without opening this file.

RPC methods are not visible here: every call shares `POST /rpc`, and the method only exists on the span as `rpc.method`. In Application Observability, filter to `service.name = feeblo-server` and group or filter by the `rpc.method` span attribute; the server names each RPC server span `RpcServer.<Tag>` and also records the method on the parent HTTP span. Traces Drilldown's span-metrics view charts request rate, error rate, and latency per method.

## Queue and email dashboards

`feeblo-server-dashboard.json` shows:

| Row | Panels |
| --- | --- |
| Integrations | Due and claimed backlog, retry/exhausted outcomes, oldest recovered lease, delivery rate by outcome, p95 latency, lease recoveries and pauses |
| Email outbox | Oldest queued age, delivery retries, throttles, estimated cost, intent/delivery transitions, retries by error tag, access skips, provider submissions, reconciliation recoveries |
| Email deliverability | Bounce and complaint rates, bounces by SES classification, suppression writes by reason and source |

## Email deliverability

The last row of `feeblo-server-dashboard.json` turns three counters into the signals a sending reputation depends on:

| Metric | Labels |
| --- | --- |
| `feeblo_email_provider_bounces_total` | `bounceType` (`hard`, `soft`, `undetermined`), `suppressed` (`true`, `false`), `correlated` (`true`, `false`) |
| `feeblo_email_provider_complaints_total` | `correlated` (`true`, `false`) |
| `feeblo_email_suppressions_written_total` | `reason` (`hard_bounce`, `complaint`, `administrative_block`), `source` (`provider`, `smtp`, `manual`) |

The rates divide the 24-hour increase in **hard bounces** — or complaints — by the 24-hour increase in `feeblo_email_provider_submissions_total`, which counts provider-accepted **outbox** submissions. AWS defines its bounce rate as hard bounces only, so soft and undetermined bounces are retried and never enter the numerator. Both rates filter `correlated="true"`: direct-send mail (password reset, OTP, invitations, onboarding) has no delivery row, so its feedback appears in the raw counters and the classification panel but not in these rates. The panels use the AWS reputation thresholds as guides: **5% hard bounce** and **10% suspension** for bounce rate, **0.1% warning** and **0.5% suspension** for complaint rate. The rolling one-hour panels show the same ratio so a spike is visible before the 24-hour window absorbs it.

`suppressed=true` means the event also wrote a suppression row, so the address will not be tried again. `undetermined` bounces are retried and never suppress; a `soft` bounce is deferred within the delivery's attempt budget. `correlated=false` marks feedback with no delivery row — direct sends and the rare correlation failure. `source=smtp` is a synchronous recipient rejection, `source=provider` is webhook feedback, and `source=manual` is an administrator adding a block. `reason` and `source` are independent labels, so a complaint written by a provider event is counted under `complaint` / `provider`.

The suppression panel counts writes, not the current list size: re-adding an address that is already suppressed increments both `provider` and `manual` totals for the rows the dashboard writes.

## Runtime and telemetry health

`feeblo-server-runtime.json` shows:

| Row | Panels |
| --- | --- |
| Telemetry export | Export failures and rejected records, as totals and by signal and reason |
| Process runtime | CPU cores, resident memory, heap used/total, event-loop utilization, and event-loop delay (mean/p99/max) |

`feeblo_telemetry_export_failures_total` counts a collector that refused, dropped, or timed out an export. `feeblo_telemetry_rejected_records_total` counts records a collector rejected in an OTLP partial-success acknowledgement, which OTLP forbids retrying. Both carry `signal` and `reason` labels. The process gauges are sampled every 30 seconds while OTLP is enabled.

## Alerts

The runtime and SLO signals are worth alerting on. Create Grafana-managed alert rules (Alerting → Alert rules → New alert rule); the dashboard's 6h range is not the alert window. Dashboard template variables are not available in an alert rule, so write the service matcher into the query — `job="feeblo/feeblo-server"` below, or `service_name="feeblo-server"` if that is the label your stack promotes.

| Signal | PromQL | Condition |
| --- | --- | --- |
| Telemetry export failing | `sum(increase(feeblo_telemetry_export_failures_total{job="feeblo/feeblo-server"}[5m]))` | `> 0` for 5m |
| Records rejected by the collector | `sum(increase(feeblo_telemetry_rejected_records_total{job="feeblo/feeblo-server"}[15m]))` | `> 0` for 5m |
| Event loop blocked | `max(nodejs_eventloop_delay_p99_seconds{job="feeblo/feeblo-server"})` | `> 0.1` for 5m |
| CPU saturated | `max(feeblo_process_cpu_cores_ratio{job="feeblo/feeblo-server"})` | `> 0.8` for 10m |
| Fast 5xx burn | `100 * sum(increase(feeblo_http_server_requests_total{job="feeblo/feeblo-server",status=~"5.."}[1h])) / clamp_min(sum(increase(feeblo_http_server_requests_total{job="feeblo/feeblo-server"}[1h])), 1)` | `> 14.4` for 5m |
| Slow 5xx burn | the fast query with `[6h]` in both places | `> 6` for 30m |
| p95 latency over objective | `histogram_quantile(0.95, sum by (le) (rate(feeblo_http_server_request_duration_milliseconds_bucket{job="feeblo/feeblo-server"}[5m])))` | `> 500` for 10m |
| Hard bounce rate over warning | `100 * (sum(increase(feeblo_email_provider_bounces_total{job="feeblo/feeblo-server",bounceType="hard",correlated="true"}[24h])) or vector(0)) / clamp_min(sum(increase(feeblo_email_provider_submissions_total{job="feeblo/feeblo-server"}[24h])), 1)` | `> 5` for 30m |
| Hard bounce rate over suspension | the same query | `> 10` for 10m |
| Complaint rate over warning | `100 * (sum(increase(feeblo_email_provider_complaints_total{job="feeblo/feeblo-server",correlated="true"}[24h])) or vector(0)) / clamp_min(sum(increase(feeblo_email_provider_submissions_total{job="feeblo/feeblo-server"}[24h])), 1)` | `> 0.1` for 30m |
| Complaint rate over suspension | the same query | `> 0.5` for 10m |

## Metric name suffixes

Grafana Cloud's OTLP-to-Prometheus conversion rewrites names following the OpenTelemetry spec. A gauge with no unit, or unit `1`, lands as `<name>_ratio` — `feeblo_integration_delivery_backlog_ratio`, `feeblo_process_cpu_cores_ratio`, and `nodejs_eventloop_utilization_ratio`. A gauge with an explicit unit takes that unit's Prometheus suffix: bytes land as `_bytes` (`process_memory_usage_bytes`, `nodejs_memory_heap_used_bytes`) and seconds as `_seconds` (`nodejs_eventloop_delay_p99_seconds`). Counters already end in `_total` and keep their name; the latency histogram is unaffected. To list exactly what your stack stores:

```promql
{__name__=~"feeblo_.*"}
```

## Empty panels

Metrics are exported every 30 seconds, and only by features that ran. An empty panel usually means the feature has seen no traffic, not that the dashboard is broken. If every panel is empty:

1. Confirm the server was deployed with `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` set (see `docs/telemetry.md`).
2. Check the service label as described above.
3. Give it a minute — the first export happens up to 30 seconds after a metric is first touched.
