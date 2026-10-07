import { currentDb, schema, transaction } from "@feeblo/db";
import { count, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";

/**
 * The workspace's CRM-entry intake.
 *
 * A contact and a company count together against the plan's `crmEntries`
 * limit, and every path that creates either must consume the allowance. The
 * protocol that makes that true is the same everywhere and easy to get wrong:
 *
 * 1. Lock the workspace row. The count below is only authoritative while the
 *    row is held, so two creates arriving near the cap cannot both see room.
 *    `for("no key update")` rather than `update`: every table in the workspace
 *    points at this row, and the stronger lock would block unrelated inserts
 *    that merely reference it. The lock comes before any child insert because
 *    each insert's foreign-key check holds a key-share on this row that would
 *    otherwise deadlock against it.
 * 2. Look for an existing entry when the caller is a find-or-create. A
 *    returning customer must not be refused at the cap, and the check has to
 *    happen *inside* the lock and *before* the allowance is consumed: the
 *    second of two requests naming the same new contact finds the first's row
 *    here and spends nothing.
 * 3. Count contacts and companies and ask `EntitlementPolicy`.
 * 4. Insert.
 *
 * Before this module each of the seven creation paths — the dashboard's
 * contact and company creates, on-behalf attribution, the Public API's end-user
 * and company creates, and the widget-SSO upserts — re-derived that order, and
 * two of them skipped step 3 entirely. The order is now here, and every
 * caller supplies only what is genuinely its own: the rows it looks for, the
 * insert it performs, and the failure it calls an unrecoverable race.
 *
 * The functions run inside one transaction (`transaction` opens a savepoint
 * when a caller already has one), so the lock covers the insert and the
 * caller's surrounding write. Each requires `EntitlementPolicy` and the
 * `Database` handle, exactly as the protocol needs; a missing layer fails the
 * composition root's type rather than one request.
 */

const lockWorkspace = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    yield* db
      .select({ id: schema.organizationTable.id })
      .from(schema.organizationTable)
      .where(eq(schema.organizationTable.id, organizationId))
      .for("no key update");
  });

/**
 * Contacts and companies, counted together.
 *
 * Two queries rather than one union, because each then uses its own
 * `organizationId` index. Only meaningful inside the transaction that holds
 * the workspace lock; `requireRoom` is the only caller.
 */
const countCrmEntries = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* currentDb;
    const [companyRows, contactRows] = yield* Effect.all([
      db
        .select({ total: count(schema.companyTable.id) })
        .from(schema.companyTable)
        .where(eq(schema.companyTable.organizationId, organizationId)),
      db
        .select({ total: count(schema.contactTable.id) })
        .from(schema.contactTable)
        .where(eq(schema.contactTable.organizationId, organizationId)),
    ]);

    return (companyRows.at(0)?.total ?? 0) + (contactRows.at(0)?.total ?? 0);
  });

const requireRoom = (organizationId: string) =>
  Effect.gen(function* () {
    const policy = yield* EntitlementPolicy;
    yield* policy.canCreateCrmEntry({
      organizationId,
      crmEntryCount: countCrmEntries(organizationId),
    });
  });

/** One creation: the caller's insert, run under the lock and the allowance. */
export interface CrmEntryCreate<A, E, R> {
  readonly insert: Effect.Effect<A, E, R>;
  readonly organizationId: string;
}

/**
 * A find-or-create: the caller's lookup and raw insert, with the race the
 * insert can lose and the caller's failure for it.
 */
export interface CrmEntryEnsure<A, FindE, InsertE, LostE, R> {
  /** Runs inside the lock before the allowance, and again after a lost race. */
  readonly find: Effect.Effect<Option.Option<A>, FindE, R>;
  /**
   * The raw insert, conflict-tolerant: `None` means a concurrent writer won a
   * unique key and `find` is the only way to learn which row it wrote.
   */
  readonly insert: Effect.Effect<Option.Option<A>, InsertE, R>;
  /**
   * Run when an insert lost a race and the re-read still found nothing. The
   * module cannot name a caller's failure; this is the effect that says what
   * that impossible conflict is in the caller's vocabulary.
   */
  readonly onLostRace: Effect.Effect<never, LostE, R>;
  readonly organizationId: string;
}

/**
 * Creates one CRM entry under the workspace lock and the plan's allowance.
 *
 * The transaction, the lock, the count, and the plan decision are the
 * module's; `insert` is the caller's (the row shape, the `source` column, and
 * the typed conflict error are surface-specific). Fails `PolicyDenied` when
 * the plan has no room; each surface maps that to its own vocabulary.
 */
export const createCrmEntry = <A, E, R>(input: CrmEntryCreate<A, E, R>) =>
  transaction(
    Effect.gen(function* () {
      yield* lockWorkspace(input.organizationId);
      yield* requireRoom(input.organizationId);
      return yield* input.insert;
    })
  );

/**
 * Returns the existing CRM entry or creates one, under the same lock and
 * allowance.
 *
 * The lookup runs after the lock and before the allowance, which is what keeps
 * a returning customer from consuming room; if the insert then loses a unique
 * key race, the lookup runs again and the winner is the answer. Only when that
 * second lookup finds nothing does the caller's `onLostRace` run.
 */
export const ensureCrmEntry = <A, FindE, InsertE, LostE, R>(
  input: CrmEntryEnsure<A, FindE, InsertE, LostE, R>
) =>
  transaction(
    Effect.gen(function* () {
      yield* lockWorkspace(input.organizationId);

      const existing = yield* input.find;
      if (Option.isSome(existing)) {
        return existing.value;
      }

      yield* requireRoom(input.organizationId);

      const inserted = yield* input.insert;
      if (Option.isSome(inserted)) {
        return inserted.value;
      }

      const winner = yield* input.find;
      return yield* Option.match(winner, {
        onNone: () => input.onLostRace,
        onSome: (entry) => Effect.succeed(entry),
      });
    })
  );
