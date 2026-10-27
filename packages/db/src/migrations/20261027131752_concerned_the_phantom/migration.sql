-- The monthly volume guard counts accepted sends since the start of the month,
-- and it runs on every send attempt, so without this index each check scans the
-- whole delivery table. The predicate is the guard's own: a delivery the
-- provider never accepted cannot spend an allowance. `accepted_at` is the
-- column that answers "did this actually go out", unlike `attempt_count`, which
-- also counts retries and render failures that never reached the provider.
CREATE INDEX "email_delivery_acceptedAt_idx" ON "email_delivery" ("accepted_at") WHERE "accepted_at" is not null;
