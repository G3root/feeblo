# Axiom MPL panels

One query per dashboard panel, mirroring `docs/grafana/`. Replace `<metrics-dataset>` with your Axiom metrics dataset. Tag names come from the OTLP attributes the server records; resource attributes are flattened into the same namespace (`service.name`, `service.namespace`, `service.instance.id`), so backtick names that contain dots.

The metric names are the source names — Axiom does not apply Grafana's Prometheus rewrites, so there is no `_ratio` suffix and no `job` label.

## HTTP APM

Requests per second:

```
`<metrics-dataset>`:`feeblo_http_server_requests_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 5m using avg
| group using sum
```

5xx ratio (multiply by 100 for percent):

```
(
  `<metrics-dataset>`:`feeblo_http_server_requests_total`
  | where `service.name` == "feeblo-server"
  | where `status` == #/5../
  | map rate
  | align to 5m using avg
  | group using sum,
  `<metrics-dataset>`:`feeblo_http_server_requests_total`
  | where `service.name` == "feeblo-server"
  | map rate
  | align to 5m using avg
  | group using sum
)
| compute error_ratio using /
| map * 100
```

4xx ratio: the same query with `#/4../`.

Latency percentiles (`interpolate_cumulative_histogram` because the server sends cumulative temporality; use `interpolate_delta_histogram(...)` with no `rate` argument if you switch to `delta`):

```
`<metrics-dataset>`:`feeblo_http_server_request_duration_milliseconds`
| where `service.name` == "feeblo-server"
| bucket to 5m using interpolate_cumulative_histogram(rate, 0.50, 0.95, 0.99)
```

Requests by status:

```
`<metrics-dataset>`:`feeblo_http_server_requests_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 5m using avg
| group by `status` using sum
```

Requests by route:

```
`<metrics-dataset>`:`feeblo_http_server_requests_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 5m using avg
| group by `route` using sum
```

5xx by route: the by-route query with `| where \`status\` == #/5../` added.

## Integrations

Delivery rate by outcome:

```
`<metrics-dataset>`:`feeblo_integration_delivery_transitions_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 5m using avg
| group by `outcome` using sum
```

Delivery p95 latency:

```
`<metrics-dataset>`:`feeblo_integration_delivery_latency_milliseconds`
| where `service.name` == "feeblo-server"
| bucket to 5m using interpolate_cumulative_histogram(rate, 0.95)
```

Due and claimed backlog (monitors should use `max`):

```
`<metrics-dataset>`:`feeblo_integration_delivery_backlog`
| where `service.name` == "feeblo-server"
| align to 5m using avg
```

```
`<metrics-dataset>`:`feeblo_integration_claimed_backlog`
| where `service.name` == "feeblo-server"
| align to 5m using avg
```

Retries and exhausting deliveries in the last 15 minutes:

```
`<metrics-dataset>`:`feeblo_integration_delivery_transitions_total`
| where `service.name` == "feeblo-server"
| where `outcome` in ["retry", "exhausted"]
| map rate
| align to 15m using avg
| group using sum
```

Lease recoveries and pauses: group `feeblo_integration_lease_recoveries_total`, `feeblo_integration_automatic_pauses_total`, and `feeblo_integration_plan_pauses_total` the same way.

## Email outbox

Oldest queued email age:

```
`<metrics-dataset>`:`feeblo_email_oldest_queued_age_milliseconds`
| where `service.name` == "feeblo-server"
| align to 5m using avg
```

Intent and delivery transitions by state:

```
`<metrics-dataset>`:`feeblo_email_delivery_transitions_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 5m using avg
| group by `state` using sum
```

Retries, throttles, and access skips: group `feeblo_email_delivery_retries_total` by `errorTag`, `feeblo_email_delivery_throttles_total` by `reason`, and `feeblo_email_delivery_access_skips_total` by `recipientClass`.

Provider submissions:

```
`<metrics-dataset>`:`feeblo_email_provider_submissions_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 5m using avg
| group by `kind`, `plan` using sum
```

Estimated cost per hour (micros to currency units, `3600 / 1000000 = 0.0036`):

```
`<metrics-dataset>`:`feeblo_email_estimated_cost_micros_total`
| where `service.name` == "feeblo-server"
| map rate
| align to 1h using avg
| map * 0.0036
```

## Traces (APL)

Same datasets as the logs if you send both to one Events dataset, or your traces dataset.

Error spans:

```
['<traces-dataset>']
| where ['service.name'] == "feeblo-server"
| where ['status.code'] == "error"
| project _time, trace_id, span_id, name, duration, ['rpc.method'], ['http.response.status_code']
| sort by _time desc
| limit 50
```

Slowest root spans per route (`isnull(parent_span_id)` selects roots so duration aggregates do not double-count children):

```
['<traces-dataset>']
| where ['service.name'] == "feeblo-server"
| where isnull(parent_span_id)
| summarize p95 = percentile(duration, 95) by name, ['http.route']
| sort by p95 desc
| limit 20
```

RPC methods only exist on the span, so this is where the per-method breakdown lives — the HTTP metrics see every call as `POST /rpc`.
