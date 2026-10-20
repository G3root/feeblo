# ADR 0020: Lock deadlines, transaction aborts are retried, and a mutex lock is `no key update`

## Decision

Three rules about row locks, applied wherever the repository takes or waits on one.

**Every Postgres connection carries a lock deadline.** `PgClientLive` sets `lock_timeout = 5s` and `idle_in_transaction_session_timeout = 30s` in the startup packet (`packages/db/src/database.ts`), so they apply to every pooled connection without a caller opting in.

**A transaction aborted by Postgres is retried.** `withTransactionAbortRetry` re-runs the whole transaction on SQLSTATE `40P01` (deadlock), `40001` (serialization failure) or `55P03` (lock timeout), twice, with jittered exponential backoff. It wraps `transaction()`, the shared boundary in `@feeblo/db`; repositories that call `db.transaction` directly wrap their own call.

**A mutex on the organization row is `FOR NO KEY UPDATE`.** `FOR UPDATE` is reserved for the one place where blocking child inserts is the point — the account-deletion re-check. The locks that only serialize a count-and-write pair take `no key update`: workspace creation (`lockUser`), the submission-window upsert, roadmap create/delete, membership role changes, the post-status position sequence, and `makeDefault`.

## Why

The trigger was an audit of every row lock and transaction in the repository, but each of the three rules stands on its own.

**The deadline is what bounds the blast radius.** The pool is ten connections per process (`@effect/sql-pg` defaults, `multiplex: false`), and a statement waiting on a row lock holds its connection. Without a deadline, ten requests contending for one workspace's organization row starve every other tenant of that process: a per-workspace lock contention becomes a whole-instance outage. The timeout converts that into one failed request. `idle_in_transaction_session_timeout` covers the one leak a pooling client cannot recover from by itself — a transaction whose fiber never resumes keeps its connection and its row locks forever.

**A retry is not a convenience here, it is the recovery.** Postgres breaks a deadlock by aborting one transaction; it does not tell the application which one deserved to lose. Treating that as an internal server error is wrong in the most expensive way: the request has done no work, the data is consistent, and the correct response is to run it again. The same is true of a serialization failure and of a lock timeout, which never ran at all. Every other error — a unique violation, a foreign-key violation, a syntax error — is deterministic and would fail identically on a retry, so the policy matches only these three codes.

The retry is safe only because no transaction in this repository performs network I/O. Effect SQL rolls the transaction back on failure, so replaying it replays database work; a Slack, Discord, Polar or S3 call made inside would be replayed too. That invariant is already held by the code — the account-deletion path performs Polar revocation after commit, with a comment saying why — and this decision makes it load-bearing rather than incidental.

**The weaker lock is the better mutex.** `FOR UPDATE` conflicts with `FOR KEY SHARE`, which is the lock a foreign-key check takes on the row it references. So a `FOR UPDATE` on the organization row blocks every insert into an organization-referencing table for the length of the transaction: comments, upvotes, invitations, uploads, board and tag writes. A post create holds that lock across activity rows, integration events, subscription writes, the submission window, and `notifySubmission` fan-out. `FOR NO KEY UPDATE` still conflicts with itself, which is the entire serialization a count-and-write pair needs, and conflicts with nothing else.

It also removes a lock-order rule instead of documenting one. The comments in `post/write.ts`, `email-outbox/repository.ts` and `roadmap/repository.ts` used to require "take the organization lock before the transaction's first child insert, or two concurrent creates deadlock", because a key-share inserted first conflicts with the later `FOR UPDATE`. Under `no key update` the key-share does not conflict, so the rule has nothing to enforce. Lock order still matters where two _different_ rows are locked — post merge and delete order their row locks by id, and workspace creation and account deletion order their organization locks by id — but it stops mattering for one row and its children.

**The one place `FOR UPDATE` stays is deliberate.** Account deletion re-checks "does this workspace still have exactly one member?" and then deletes the workspace. That check must be authoritative against a concurrent invitation acceptance, and an accepted invitation inserts a `member` row whose foreign-key check needs a key-share on the organization row. Only `FOR UPDATE` conflicts with that. The transaction previously also took `FOR UPDATE` on every member row; that was redundant for inserts (the organization lock already blocks them) and made the path deadlock-prone, because `post_subscription`, `upvote`, `post_reaction`, `changelog_subscription` and `comment_reaction` declare their user and member foreign keys before their organization one, so an insert takes the member key-share first and then waits on the organization key-share.

## Rejected alternatives

**`SET LOCAL lock_timeout` per transaction.** It puts the deadline in the hands of every caller, and the failure mode is exactly the caller that forgot. A connection default cannot be forgotten, and a transaction that genuinely needs longer can raise it explicitly.

**Retrying inside the statement rather than the transaction.** A deadlock aborts the whole transaction, so a retry at statement scope fails with `25P02` (`in_failed_sql_transaction`) instead of recovering. The retry belongs at the boundary, which is why `transaction()` is the place and why a direct `db.transaction` caller has to wrap itself.

**Unbounded retries.** Three attempts bounds the added latency to roughly one round-trip plus under 200 ms of backoff. A request that is still losing after that is under sustained contention, and a longer wait only moves the wait into the client.

**Keeping `FOR UPDATE` and documenting the lock order.** It is what the repository did. Documentation cannot prevent the deadlock — it only makes the code that ignores it wrong on purpose — and it leaves every workspace write blocked behind a post create.

**Making the sixteen new foreign-key indexes plain `CREATE INDEX` migrations.** Drizzle applies all pending migrations in one transaction, so every `CREATE INDEX` in a batch holds a SHARE lock on its table until the last migration commits: on `post` or `comment` that is a write outage for the deploy. They are built with `CREATE INDEX CONCURRENTLY` after the transactional pass, where `post_embedding_hnsw_idx` and the trigram indexes already are, and the snapshot beside the empty migration keeps `drizzle-kit generate` from emitting them again.

**Relying on the entrypoint being singular.** Every server replica runs the migrator from its `CMD`. Without a lock, two replicas starting together read the same applied-migration list and execute the same DDL; the second blocks on the first's locks and then fails on objects that already exist. A session-scoped advisory lock makes it wait, re-read, and find nothing to do. A dedicated migration job is the better long-term shape, and this makes the current one safe until there is one.

## Consequences

- A lock wait now fails a request after five seconds instead of hanging. A workspace whose writes genuinely take longer than five seconds to serialize will see `55P03` errors under load; the retry hides two of them, and the third surfaces as a 500. That is the intended trade: a visible, bounded failure over an invisible, unbounded one.
- `55P03` surfaces as a 500 rather than a 503. Mapping it to a retryable status is a separate change in `withRemapDbErrors`, which owns the error vocabulary for the RPC surface.
- Only `transaction()` retries, plus the two repositories that hold organization locks from their own transactions and therefore wrap them: `roadmap/repository.ts` (`create`, `deleteWithPrimaryHandoff`) and `post-status/repository.ts` (`update`, `makeDefault`, `delete`, `reorder`). The remaining direct `db.transaction` callers — `integrations/*`, the post merge/delete paths, the email outbox queue — still return a 500 on a deadlock. Each is a one-line change when it becomes a problem; none of them takes a lock whose cycle is reachable today.
- The new indexes cost write throughput on `post`, `comment`, `upvote`, `post_subscription`, `post_tag`, `post_reaction`, `comment_reaction`, `changelog_subscription`, `changelog_category_link`, `invitation` and `notification_preference`. They buy shorter cascade scans while a delete holds its row locks, which is the case that was actually measurable. Roughly twenty uncovered foreign keys remain — mostly `NO ACTION` or `RESTRICT` against parents the application does not delete — and adding them would be write cost with no reader.
- The migrator now waits for a lock instead of racing. A replica that starts while another is migrating blocks in its entrypoint until the first finishes, which is a slower rollout and a correct one.
- Migration DDL still runs in one transaction per batch; this decision does not change that. A future release that needs a `CONCURRENTLY` build or a table rewrite must put it in the migrator's post-pass, not in `migration.sql`.
