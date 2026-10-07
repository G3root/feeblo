# ADR 0014: Revoking a deleted workspace's subscription is durable

## Decision

Deleting a workspace or an account writes every external Polar subscription id into `subscription_revocation` before the `subscription` rows cascade away, then attempts the revocation. Anything Polar does not acknowledge stays queued; `subscriptionRevocationMaintenance` retries the queue every five minutes from the server composition root. `PolarService.revokeSubscription` surfaces `FailedToRevokeSubscriptionError` instead of logging and succeeding, so the queue can tell a refusal from a success.

The queue row carries the workspace id but deliberately has no foreign key to `organization`. It is only eligible for revocation while that organization row is **gone**:

```sql
where revoked_at is null
  and not exists (select 1 from organization where organization.id = revocation.organization_id)
```

Account deletion enqueues inside the same transaction that deletes the organizations, so a rollback leaves neither a deleted workspace nor queued work. The workspace-delete hook enqueues in `beforeDeleteOrganization` (the subscription rows still exist) and attempts the revocation in `afterDeleteOrganization` (the row is gone). If the adapter delete fails, the queued row survives and the loop skips it while the workspace exists.

## Why

The previous behaviour revoked before deleting and swallowed every failure. A Polar outage at that moment — or a checkout whose `subscription.created` webhook had not landed yet, so no local row existed to find — left a live subscription charging a workspace Feeblo had already erased, with no record left to retry from. Continuing to charge a deleted tenant is a money bug; deleting the only copy of the external id while unable to cancel it is the same bug made permanent.

The organization-gone gate is what makes retries safe. A queued row is data, not intent: while the workspace exists the deletion either failed or was rolled back, so revoking would take a paying workspace offline. Once the row is gone there is no workspace left to protect. A Polar call that succeeds but whose result cannot be recorded is retried, and Polar answers an already-canceled subscription with an error; the loop records that attempt and moves on rather than opening the row again, so the worst case is a noisy `last_error`, not a double revocation or a missed one.

Refusing deletion while Polar is unreachable was rejected. Account erasure is a user right that must not depend on a third party's availability, and the workspace-delete hook cannot hold a database transaction open across a network call. Durability in a local queue is the version that survives both.

## Consequences

`packages/domain/src/billing/revocation.ts` owns the pass; `apps/server` owns the loop. A deployment that runs the auth handler without the server program (a worker, a one-off script) enqueues but does not retry until the server runs, which is the right tradeoff for a self-hosted stack and is the same shape as the integration delivery worker.

`subscription_revocation` rows are kept after `revoked_at` for audit. The queue is small (one row per deleted subscription) and nothing prunes it yet; a retention sweep belongs with the integration retention maintenance when volume justifies it.

`last_error` and `attempts` are the only signal a failed revocation leaves. There is no metric or alert on them yet, so an operator finds an outage by reading the table; a `feeblo_subscription_revocation_failures_total` counter is the obvious follow-up.
