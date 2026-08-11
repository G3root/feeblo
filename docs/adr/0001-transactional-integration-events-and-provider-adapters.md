# ADR 0001: Transactional integration events and provider adapters

## Decision

Feeblo records integration events and matching durable deliveries in the same database transaction as the domain mutation. A provider-neutral kernel owns events, routes, delivery state, retry policy, and history. Provider packages own protocol translation and external calls. The server statically composes registered providers at startup.

## Why

`NotificationService` creates member inbox notifications and `PostActivity` creates user-visible audit history; neither is an external-delivery ledger. Synchronous HTTP in a post mutation would make an external outage delay or roll back Feeblo data. Runtime plugins make startup validation, dependency ownership, and security review unclear. One durable workflow per delivery is unnecessary for V1: PostgreSQL is the durable coordination system and leased workers can safely recover work across replicas.

The transaction ends before any provider request. This yields at-least-once delivery: a crash after remote acceptance and before local acknowledgement can cause a duplicate, so consumers must deduplicate with the stable delivery ID.

## Consequences

V1 has only signed outbound custom webhooks. Inbox events, bindings, and bidirectional synchronization remain future concepts and are not represented as implemented behavior here.
