# ADR 0014: Revoking a deleted workspace's subscription is durable

## Decision

Deleting a workspace or an account writes every external Polar subscription id into `subscription_revocation` before the `subscription` rows cascade away, then attempts the revocation. Anything Polar does not acknowledge stays queued; `subscriptionRevocationMaintenance` retries the queue every five minutes from the server composition root. `PolarService.revokeSubscription` surfaces `FailedToRevokeSubscriptionError` instead of logging and succeeding, so the queue can tell a refusal from a success, and the error carries Polar's HTTP status and typed error discriminant so a failed row's `last_error` says which refusal keeps recurring.

The queue row carries the workspace id but deliberately has no foreign key to `organization`. It is only eligible for revocation while that organization row is **gone**:

```sql
where revoked_at is null
  and not exists (select 1 from organization where organization.id = revocation.organization_id)
```

Account deletion enqueues inside the same transaction that deletes the organizations, so a rollback leaves neither a deleted workspace nor queued work. The workspace-delete hook enqueues in `beforeDeleteOrganization` (the subscription rows still exist) and attempts the revocation in `afterDeleteOrganization` (the row is gone). If the adapter delete fails, the queued row survives and the loop skips it while the workspace exists.

Each row records the Polar target (`polar_server`, the SDK's sandbox/production server) its subscription came from, copied from the `polar_server` the webhook sync stamps on the subscription row itself. The sweep query excludes rows bound to a target other than the configured one, so a stale batch of mismatched rows cannot occupy the sweep's batch window and starve newer rows; the queue row processor keeps the same check as defense for a caller that bypasses the query, because a 404 from a server that never held the subscription is not evidence it is gone, and a deployment stores one target's credential so it cannot address the other. Mismatched rows wait for an operator to restore the target configuration or reconcile them manually.

A subscription event that arrives for an already-deleted workspace is not merely acknowledged: when its metadata `org` is a workspace id this deployment minted, the handler writes a revocation row for it (idempotently, so a revocation the deletion already queued is never duplicated or re-opened) before acknowledging. This closes the case the retry loop alone cannot see — a `subscription.created` whose first delivery failed, with the workspace deleted before any redelivery, so the deletion had no local subscription row to enqueue from. A metadata `org` that is not a Feeblo workspace id is foreign metadata and is only logged, because revoking on metadata this deployment never wrote could cancel a subscription the operator created directly in Polar.

## Why

The previous behaviour revoked before deleting and swallowed every failure. A Polar outage at that moment — or a checkout whose `subscription.created` webhook had not landed yet, so no local row existed to find — left a live subscription charging a workspace Feeblo had already erased, with no record left to retry from. Continuing to charge a deleted tenant is a money bug; deleting the only copy of the external id while unable to cancel it is the same bug made permanent.

The organization-gone gate is what makes retries safe. A queued row is data, not intent: while the workspace exists the deletion either failed or was rolled back, so revoking would take a paying workspace offline. Once the row is gone there is no workspace left to protect. A Polar call that succeeds but whose result cannot be recorded is retried, and Polar answers an already-terminated subscription with its typed 403 `AlreadyCanceledSubscription` or 404 `ResourceNotFound`; against the row's originating target those are the one refusal the loop treats as achieved and closes the row, because `can_cancel` is false for every non-billable state and a missing row has nothing left to charge. The typed discriminants are matched rather than bare status codes — a 404 whose body is not `ResourceNotFound` is a refusal that stays pending — so the worst case is a noisy `last_error`, not a double revocation or a missed one.

Refusing deletion while Polar is unreachable was rejected. Account erasure is a user right that must not depend on a third party's availability, and the workspace-delete hook cannot hold a database transaction open across a network call. Durability in a local queue is the version that survives both.

## Consequences

`packages/domain/src/billing/revocation.ts` owns the pass; `apps/server` owns the loop. A deployment that runs the auth handler without the server program (a worker, a one-off script) enqueues but does not retry until the server runs, which is the right tradeoff for a self-hosted stack and is the same shape as the integration delivery worker.

Subscription rows synced before `polar_server` existed have no known origin; the queue falls back to the configured target when enqueueing them. For a deployment that never changed targets the fallback is exact. For one that changed targets after syncing, a legacy row can be closed on a wrong-target 404 while the real subscription still bills on the old target — a one-time hazard bounded to pre-upgrade rows, accepted here rather than met with an origin the database does not have.

`subscription_revocation` rows are kept after `revoked_at` for audit. The queue is small (one row per deleted subscription) and nothing prunes it yet; a retention sweep belongs with the integration retention maintenance when volume justifies it.

`last_error` and `attempts` are the only signal a failed revocation leaves. There is no metric or alert on them yet, so an operator finds an outage by reading the table; a `feeblo_subscription_revocation_failures_total` counter is the obvious follow-up.
