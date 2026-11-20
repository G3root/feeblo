# @feeblo/db

Drizzle schema, migrations, the PGlite test database, and the seed and nuke scripts. `transaction()` and `attachCause` export from here.

## Transactions

`transaction()` re-runs the whole body on `40P01` (deadlock), `40001` (serialization failure) and `55P03` (lock timeout), so a transaction body is database work only: no HTTP call, no provider client, no filesystem write, because a retry replays it.

A repository that calls `db.transaction` directly bypasses that retry. Wrap it in `withTransactionAbortRetry` for the same reason the helper exists.

A mapping inside a transaction keeps the failure it replaced, using `attachCause`. The retry reads the `cause` chain, so a message-only replacement turns a retryable abort into a 500.

Every connection carries a 5-second `lock_timeout` and a 30-second idle-in-transaction timeout, so a lock wait fails a request instead of holding a pooled connection forever.

`FOR NO KEY UPDATE` serializes a count-and-write pair on one workspace. `FOR UPDATE` is for the case where blocking child inserts is the point, which today is only the account-deletion membership re-check. Both live in `packages/domain/src/row-locks.ts`.

## Migrations

Snapshots in `src/migrations/` are format 9 and form a **diff chain**, where each holds only its delta from its parent. Read `docs/toolchain.md` before rebasing, squashing or regenerating.

A schema change lands as `pnpm db:generate` output committed beside the schema edit, never as a hand-edited snapshot or renamed folder. Migrations are irreversible in production and need owner sign-off.

## Tests

PGlite stands up the schema for `it.effect` tests. The one place a database is shared across a file as a plain value is `packages/auth/src/api-key.test.ts`, whose `oxlint-disable` carries the reason inline.
