# Telemetry

Feeblo exports OpenTelemetry Protocol (OTLP) traces, logs, and metrics from the server, and keeps Sentry as the error channel. The exporters are Effect's own (`effect/observability`), so the only dependency is `effect` itself — this is a port of `UsefulSoftwareCo/executor`'s `packages/telemetry`, trimmed to what a first-party server needs.

## Wiring

| File | Role |
| --- | --- |
| `apps/server/src/infra/observability.ts` | Chooses Sentry-only or Sentry + OTLP, and owns the final logger set |
| `apps/server/src/infra/telemetry/config.ts` | Parses the standard `OTEL_EXPORTER_OTLP_*` environment |
| `apps/server/src/infra/telemetry/layer.ts` | Builds the OTLP tracer, logger, and metrics layers |
| `apps/server/src/infra/telemetry/span-attributes.ts` | HTTP attribute allowlist, root-span filter, and ratio sampling |
| `apps/server/src/infra/telemetry/rpc-spans.ts` | Adds `rpc.*` attributes and labels the parent HTTP span per RPC method |
| `apps/server/src/infra/sentry.ts` | Sentry SDK, logger, metrics, and tracer, each optional |

`program.ts` provides `makeObservabilityLayer` around the whole program, so layer construction, the forked workers, and the HTTP server all share one tracer and one logger set.

## Environment

| Variable | Meaning |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base OTLP/HTTP URL. The exporters append `/v1/traces`, `/v1/logs`, `/v1/metrics`. Unset disables OTLP entirely. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `_LOGS_` / `_METRICS_` | Per-signal override, used verbatim. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Backend credentials, `key=value,key2=value2` (URI-encoded). A per-signal `_HEADERS` override wins. |
| `OTEL_EXPORTER_OTLP_METRICS_PROTOCOL` | `http/protobuf` (default) or `http/json`. |
| `FEEBLO_TELEMETRY_TRACES_SAMPLE_RATE` | Root-span ratio, `0.0`–`1.0`, default `1`. Children always follow their root's decision. |
| `FEEBLO_TELEMETRY_DROP_ROOT_SPANS` | Drop parentless `sql.execute` / `sql.transaction` spans, default `true`. Set `false` to keep them while debugging a poller. |
| `OTEL_SERVICE_NAME` | Defaults to `feeblo-server`. |
| `APP_RELEASE` | Reported as `service.version`. |

## Span shaping

Two policies run in the tracer wrappers the OTLP layer installs (`span-attributes.ts` and `rpc-spans.ts`):

- **RPC methods.** `effect/rpc` names each server span `RpcServer.<Tag>`, but every call shares the same `POST /rpc` HTTP route. `rpc-spans.ts` adds `rpc.system.name=effect` and `rpc.method=<Tag>` to the RPC span, and records `rpc.method` on the parent HTTP span (or on the HTTP link when the client owns the trace context), so a backend can filter and group by method instead of the anonymous route. When one HTTP span serves more than one method, the shared span keeps every distinct method as an array instead of the last write winning; each RPC span still carries the scalar method it serves. The prefix is pinned by `rpcSpanPrefix` in `@feeblo/domain/rpc-router`, which also passes it to `RpcServer.layerHttp`.
- **Root library spans.** Queue pollers and delivery workers run without a parent request, so Effect SQL's `sql.execute` and `sql.transaction` arrive as roots and every 1 Hz poll becomes a standalone trace. Those root names are dropped; a SQL span under a request keeps its parent and is exported.

## Local development

[motel](https://github.com/kitlangton/motel) is a local OTLP ingest with a TUI and a web UI, backed by SQLite:

```sh
bunx @kitlangton/motel
```

Then run the server with:

```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:27686 pnpm dev:server
```

Motel keeps seven days locally by default and needs no Docker or account. It is a development tool: for production, point the endpoint at a collector built for retention and multi-user access.

## Production (Dokploy and compose)

Set the same variables in the Dokploy environment (or `.env` for `docker-compose.yml`, which passes the endpoint, headers, and sample rate through). Suitable backends:

- **SigNoz** — traces, logs, metrics, and exceptions in one self-hosted UI.
- **Grafana LGTM** (Tempo + Loki + Grafana) — the standard OTLP stack.
- **Grafana Cloud / Axiom / Better Stack** — hosted OTLP, free tiers, no collector to run.

Sampling is the cost control: the server emits every span when the rate is `1`, and a busy workspace can produce millions of SQL spans per day. Set `FEEBLO_TELEMETRY_TRACES_SAMPLE_RATE` to `0.05`–`0.2` in production and let the backend's retention policy bound storage. Effect's `Tracer.MinimumTraceLevel` is also available for dropping low-level spans wholesale.

## Sentry

Sentry keeps capturing errors. Its tracer is only installed when no OTLP traces endpoint is configured, because Effect carries a single `Tracer.Tracer`. When OTLP logs or metrics are configured, Sentry's logger and metrics layer are left off to avoid shipping the same signal twice; with only an OTLP traces endpoint, Sentry logs and metrics stay as before.

`makeSentryLayer` accepts `{ tracer, logger, metrics }` for that decision. The `SENTRY_TRACES_SAMPLE_RATE` value still applies whenever Sentry is the tracer.

## What is deliberately not ported

Executor runs untrusted app isolates and bills by owner; Feeblo does neither, so these parts were left behind:

- **Ownership accounting** (`ownedBy`, `measuredSpan`) — per-owner time splitting for billing.
- **Isolate relay and the closed span vocabulary** — app isolates there cannot hold credentials, so the host rebuilds their records from a fixed vocabulary. Feeblo's spans are first-party.
- **Error-text scrubbing** — Executor rewrites exception messages before export because an app can put arbitrary text in them. Feeblo's tagged errors carry code-authored text, so traces keep the messages; the HTTP attribute allowlist is the security boundary that matters here.
- **The bundled motel/workerd collector** — production should use a collector with retention and access control, not a local SQLite daemon.
