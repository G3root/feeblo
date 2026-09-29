import { currentDb, schema } from "@feeblo/db";
import type { TEntitySource } from "@feeblo/domain-contracts/entity-source";
import { and, count, eq, ne } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import type { Cursor } from "../../public-api/cursor";
import type { CrmEntryAllowanceError } from "../../public-api/entitlement";
import { conflictError } from "../../public-api/errors";
import { withRemapDbErrors } from "../../rpc-errors";
import { CompanyRepository } from "../repository";
import type { TPublicApiCompanySourceType } from "./schema";

/**
 * What a company mapper is allowed to read.
 *
 * Narrow for the same reason as the post and tag sources: the company row also
 * carries `organizationId`, and a mapper that could accept the repository's row
 * could pass it through. The source names the published fields only.
 */
export type PublicApiCompanySource = {
  readonly id: string;
  readonly name: string;
  readonly externalId: string | null;
  readonly avatar: string | null;
  readonly externalCreatedAt: Date | null;
  readonly source: TPublicApiCompanySourceType;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type PublicApiCompanyPage = {
  readonly companies: readonly PublicApiCompanySource[];
  readonly nextCursor: Cursor | null;
};

const toCompanySource = (row: {
  readonly id: string;
  readonly name: string;
  readonly externalId: string | null;
  readonly avatar: string | null;
  readonly externalCreatedAt: Date | null;
  readonly source: TEntitySource;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}): PublicApiCompanySource => ({
  avatar: row.avatar,
  createdAt: row.createdAt,
  externalCreatedAt: row.externalCreatedAt,
  externalId: row.externalId,
  id: row.id,
  name: row.name,
  source: row.source,
  updatedAt: row.updatedAt,
});

/**
 * The conflict a unique-index race reports.
 *
 * The driver names the constraint it violated, not a field, so a collision
 * that beats the handler's pre-check can only be reported as "one of these two
 * already exists". The pre-check answers the ordinary duplicate with the field
 * it actually found, which is the case a caller can act on.
 */
const COMPANY_UNIQUE_VIOLATION_MESSAGE =
  "A company with this name or externalId already exists.";

/**
 * Company storage as the Public API alone reads it.
 *
 * The writes are `CompanyRepository`'s own — the same insert, update, and
 * delete the dashboard's CRM RPCs call, with `API` as the recorded source — and
 * this service adds only the parts that are public-specific: cursor-shaped
 * paging, the pre-checks that name the colliding field, and the plan gate that
 * holds the workspace row while the count and the insert are decided together.
 */
const makePublicApiCompanyRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const companies = yield* CompanyRepository;

  return {
    /**
     * One page of the workspace's companies, newest first.
     *
     * Ordered and paged exactly like a board's posts and the workspace's tags —
     * the same `(createdAt, id)` tuple and the same cursor — so a caller learns
     * one paging rule for the whole API.
     */
    list: ({
      cursor,
      limit,
      organizationId,
    }: {
      cursor: Cursor | null;
      limit: number;
      organizationId: string;
    }) =>
      companies.findPage({ after: cursor, limit, organizationId }).pipe(
        Effect.map((rows) => {
          const hasMore = rows.length > limit;
          const pageRows = hasMore ? rows.slice(0, limit) : rows;
          const lastRow = pageRows.at(-1);

          return {
            companies: pageRows.map(toCompanySource),
            nextCursor:
              hasMore && lastRow !== undefined
                ? { createdAt: lastRow.createdAt, id: lastRow.id }
                : null,
          } satisfies PublicApiCompanyPage;
        }),
        withRemapDbErrors("PublicApiCompany", "select")
      ),

    /** One company of the calling workspace, or nothing. */
    find: ({
      companyId,
      organizationId,
    }: {
      companyId: string;
      organizationId: string;
    }) =>
      companies
        .findById({ id: companyId, organizationId })
        .pipe(
          Effect.map(Option.map(toCompanySource)),
          withRemapDbErrors("PublicApiCompany", "select")
        ),

    /**
     * The company that already holds this name, if any.
     *
     * `company_organizationId_name_uidx` is the authority; this is the courtesy
     * check that lets an ordinary duplicate be answered with a message about
     * the name instead of a driver error the caller cannot act on.
     */
    findNameConflict: ({
      excludeCompanyId,
      name,
      organizationId,
    }: {
      excludeCompanyId: string | null;
      name: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.companyTable.id })
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.organizationId, organizationId),
              eq(schema.companyTable.name, name),
              ...(excludeCompanyId === null
                ? []
                : [ne(schema.companyTable.id, excludeCompanyId)])
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),

    /**
     * The company that already holds this external id, if any.
     *
     * Looked up separately from the name so the message can say which field
     * collided: `externalId` is the caller's own identifier, and being told
     * that a *name* is taken when the caller reused a sync key would send them
     * looking in the wrong place. Postgres treats `NULL` as distinct in a
     * unique index, so an unset external id never conflicts with another unset
     * one and is never passed here.
     */
    findExternalIdConflict: ({
      excludeCompanyId,
      externalId,
      organizationId,
    }: {
      excludeCompanyId: string | null;
      externalId: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.companyTable.id })
          .from(schema.companyTable)
          .where(
            and(
              eq(schema.companyTable.organizationId, organizationId),
              eq(schema.companyTable.externalId, externalId),
              ...(excludeCompanyId === null
                ? []
                : [ne(schema.companyTable.id, excludeCompanyId)])
            )
          )
          .limit(1);

        return Option.fromNullishOr(rows.at(0));
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),

    /**
     * Creates a company, in the transaction that proves the plan has room.
     *
     * The plan's entry limit counts rows that mostly do not exist yet, so there
     * is no row among them to lock: two creates arriving near the cap would
     * both count the entries committed so far and both see room. The workspace
     * row is locked instead, which gives them one order — the second create
     * waits here, then counts the first one's row — and `ensureRoom` runs after
     * that lock and before the insert, so the number it reads and the row it
     * authorizes are decided together rather than a statement apart.
     *
     * `no key update` rather than `update`, for the reason the tag write gives:
     * every table in the workspace points at this row, and the stronger lock
     * would block unrelated inserts that merely reference the workspace.
     *
     * `source` is written as `API` rather than taken from the request: it is
     * this API's record of where the row came from, and a caller that could
     * claim `DASHBOARD` would make the dashboard's own provenance column lie. A
     * company the widget provisions stays `WIDGET`.
     *
     * Both unique indexes are mapped as well as pre-checked, because two
     * concurrent creates collide after both checks pass and one of them then
     * loses the race at an index. That fallback cannot say which of the two
     * collided — the driver reports a constraint, not a field — so it names
     * both rather than guessing; the pre-check has already answered the
     * ordinary case with the precise field. The mapping wraps the transaction
     * rather than the statement so a failure that only surfaces on commit is
     * answered on the same vocabulary.
     */
    create: ({
      avatar,
      ensureRoom,
      externalCreatedAt,
      externalId,
      name,
      organizationId,
    }: {
      avatar: string | null;
      ensureRoom: Effect.Effect<void, CrmEntryAllowanceError>;
      externalCreatedAt: Date | null;
      externalId: string | null;
      name: string;
      organizationId: string;
    }) =>
      db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .select({ id: schema.organizationTable.id })
              .from(schema.organizationTable)
              .where(eq(schema.organizationTable.id, organizationId))
              .for("no key update");

            yield* ensureRoom;

            const created = yield* companies
              .create(
                {
                  avatar,
                  externalCreatedAt,
                  externalId,
                  name,
                  organizationId,
                },
                { source: "API" }
              )
              .pipe(
                // The domain reports a name collision as a typed failure; the
                // index race that beats the pre-check is a driver error, mapped
                // below. Both answer on the published `CONFLICT`.
                Effect.catchTag("CompanyAlreadyExistsError", () =>
                  Effect.fail(conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE))
                )
              );

            return toCompanySource(created);
          })
        )
        .pipe(
          withRemapDbErrors({
            action: "create",
            entity: "PublicApiCompany",
            onUniqueViolation: () =>
              conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE),
          })
        ),

    /**
     * Applies the fields the request named and returns the row the database
     * stored, or nothing when there is no such company any more.
     *
     * `None` rather than a failure: the handler reads the company before
     * calling this, so an update that matches no row was raced by someone
     * else's delete, and the honest answer to the caller is the documented
     * "not found" rather than a server error for a request they made in good
     * faith. The unique violation is still mapped, because a rename can lose
     * the race at the index even though the pre-check passed.
     */
    update: ({
      avatar,
      companyId,
      externalCreatedAt,
      externalId,
      name,
      organizationId,
    }: {
      avatar: string | null | undefined;
      companyId: string;
      externalCreatedAt: Date | null | undefined;
      externalId: string | null | undefined;
      name: string | undefined;
      organizationId: string;
    }) =>
      companies
        .update({
          avatar,
          externalCreatedAt,
          externalId,
          id: companyId,
          name,
          organizationId,
        })
        .pipe(
          Effect.map(Option.map(toCompanySource)),
          withRemapDbErrors({
            action: "update",
            entity: "PublicApiCompany",
            onUniqueViolation: () =>
              conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE),
          })
        ),

    /**
     * Deletes a company and reports whether there was one to delete.
     *
     * `false` rather than a silent success: the handler reads the company
     * before calling this, so a delete that matched no row was raced by someone
     * else's delete, and a caller who named the wrong workspace is owed the
     * documented "not found" rather than a success that hides it.
     *
     * `contact.companyId` is `set null`, so the people who belonged to the
     * company survive it and keep their own records — the same behaviour as
     * deleting it in the dashboard. The company's attribute values cascade.
     */
    delete: ({
      organizationId,
      companyId,
    }: {
      organizationId: string;
      companyId: string;
    }) =>
      companies
        .delete({ id: companyId, organizationId })
        .pipe(
          Effect.map(Option.isSome),
          withRemapDbErrors("PublicApiCompany", "delete")
        ),

    /**
     * How many CRM entries the workspace holds, for the plan's entry limit.
     *
     * Counts rows and selects nothing: this API does not return contacts, but
     * the plan limit that gates creating a company counts them, and the
     * dashboard's own create is gated on the same number. Two queries rather
     * than one union, because each then uses its own `organizationId` index.
     *
     * Only meaningful inside the write transaction that holds the workspace
     * lock (`create`): read anywhere else, the number it returns can be stale
     * by the time the row it authorizes is inserted.
     */
    countCrmEntries: (organizationId: string) =>
      Effect.gen(function* () {
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

        return (
          (companyRows.at(0)?.total ?? 0) + (contactRows.at(0)?.total ?? 0)
        );
      }).pipe(withRemapDbErrors("PublicApiCompany", "select")),
  };
});

export class PublicApiCompanyRepository extends Context.Service<PublicApiCompanyRepository>()(
  "PublicApiCompanyRepository",
  {
    make: makePublicApiCompanyRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

/**
 * Reads the repository from the fiber context.
 *
 * `HttpApiBuilder` does not thread a handler's service requirements through the
 * route layer, so handlers take services from the context the composition
 * provides — the same shape as `currentPublicApiCaller`.
 */
export const currentPublicApiCompanyRepository = Effect.context<never>().pipe(
  Effect.map((context) =>
    Context.getUnsafe(context, PublicApiCompanyRepository)
  )
);
