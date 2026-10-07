import { Database, schema } from "@feeblo/db";
import { eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { CompanyRepository } from "../../company/repository";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import { requireCrmEntryAllowance } from "../../public-api/entitlement";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  PlanRequiresUpgradeError,
  conflictError,
  invalidRequestError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { PublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { parseName } from "../../public-api/parse";
import { withRemapDbErrors } from "../../rpc-errors";
import { toCompanySource, toPublicApiCompany } from "./mappers";
import {
  CreateCompanyInput,
  DeleteCompanyInput,
  GetCompanyInput,
  ListCompaniesInput,
  PublicApiCompany,
  PublicApiCompanyPage,
  UpdateCompanyInput,
} from "./schema";

const COMPANY_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/** A create can collide with a name or external id, but cannot report a 404. */
const COMPANY_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  ConflictError,
  PlanRequiresUpgradeError,
  InternalError,
]);

/** A rename can collide; a delete cannot. */
const COMPANY_UPDATE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
]);

const COMPANY_DELETE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * The pre-check's messages, one per colliding field.
 *
 * The index race that beats the pre-check is reported by the mapping below,
 * which cannot say which of the two indexes was violated.
 */
const COMPANY_NAME_CONFLICT = "A company with this name already exists.";

const COMPANY_EXTERNAL_ID_CONFLICT =
  "A company with this externalId already exists.";

/**
 * The conflict a unique-index race reports.
 *
 * The driver names the constraint it violated, not a field, so a collision
 * that beats the pre-check can only be reported as "one of these two already
 * exists". The pre-check answers the ordinary duplicate with the field it
 * actually found, which is the case a caller can act on.
 */
const COMPANY_UNIQUE_VIOLATION_MESSAGE =
  "A company with this name or externalId already exists.";

/**
 * Rejects a name, or an external id, another company in the workspace holds.
 *
 * A courtesy to the caller, not the authority: the two unique indexes are, and
 * the write maps their violation to the same conflict. Checking first means an
 * ordinary duplicate is answered with a message about the field that actually
 * collided, which is the difference between "rename it" and "that sync id is
 * already in use" for a caller that has to decide what to do next.
 *
 * `excludeCompanyId` is what lets a company keep its own name and its own
 * external id through an update. A name or external id that is not being
 * written is `null` and is never checked; `externalId` is nullable, and
 * Postgres treats `NULL` as distinct in a unique index, so two companies may
 * both leave it unset.
 */
const failIfCompanyIsTaken = (args: {
  readonly excludeCompanyId: string | null;
  /** The external id the write would store, or null when it is not changing. */
  readonly externalId: string | null;
  /** The name the write would store, or null when it is not changing. */
  readonly name: string | null;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const companies = yield* CompanyRepository;

    if (args.name !== null) {
      const nameTaken = yield* companies
        .findNameConflict({
          excludeCompanyId: args.excludeCompanyId,
          name: args.name,
          organizationId: args.organizationId,
        })
        .pipe(
          withRemapDbErrors("PublicApiCompany", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      if (Option.isSome(nameTaken)) {
        return yield* conflictError(COMPANY_NAME_CONFLICT);
      }
    }

    if (args.externalId === null) {
      return undefined;
    }

    const externalIdTaken = yield* companies
      .findExternalIdConflict({
        excludeCompanyId: args.excludeCompanyId,
        externalId: args.externalId,
        organizationId: args.organizationId,
      })
      .pipe(
        withRemapDbErrors("PublicApiCompany", "select"),
        Effect.catchTag("InternalServerError", () => onInternalError)
      );

    if (Option.isSome(externalIdTaken)) {
      return yield* conflictError(COMPANY_EXTERNAL_ID_CONFLICT);
    }

    return undefined;
  });

/**
 * The company operations.
 *
 * The row writes are `CompanyRepository`'s own, and the plan's room check runs
 * inside the same transaction that holds the workspace lock, so the Public API
 * and the dashboard cannot disagree about what the CRM limit means. What is
 * public-specific is the cursor paging, the pre-checks that name the colliding
 * field, and the published error vocabulary.
 */

export const listCompaniesOperation = defineOperation(
  "listCompanies",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "List the workspace's companies, newest first.",
    failure: COMPANY_READ_FAILURES,
    input: ListCompaniesInput,
    output: PublicApiCompanyPage,
    scope: "companies.read",
  },
  ({ cursor, limit }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const companies = yield* CompanyRepository;

      const after = yield* decodeCursorOrFail(cursor);
      const pageSize = limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT;

      const rows = yield* companies
        .findPage({
          after,
          limit: pageSize,
          organizationId: caller.organizationId,
        })
        .pipe(
          withRemapDbErrors("PublicApiCompany", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const lastRow = pageRows.at(-1);

      return {
        data: pageRows.map((row) => toPublicApiCompany(toCompanySource(row))),
        nextCursor:
          hasMore && lastRow !== undefined
            ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
            : null,
      };
    })
);

export const createCompanyOperation = defineOperation(
  "createCompany",
  {
    description: "Create a company in the calling workspace.",
    failure: COMPANY_CREATE_FAILURES,
    input: CreateCompanyInput,
    output: PublicApiCompany,
    scope: "companies.create",
  },
  ({ avatar, externalCreatedAt, externalId, name: rawName }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const db = yield* Database.Database;
      const companies = yield* CompanyRepository;

      const name = yield* parseName(rawName);

      yield* failIfCompanyIsTaken({
        excludeCompanyId: null,
        externalId: externalId ?? null,
        name,
        organizationId: caller.organizationId,
      });

      // The plan gate and the insert are one transaction: the workspace row is
      // locked, the check runs after that lock, and only then is the row
      // written, so two creates arriving near a plan's cap cannot both see
      // room. `no key update` rather than `update` because every table in the
      // workspace points at this row, and the stronger lock would block
      // unrelated inserts that merely reference the workspace.
      const created = yield* db
        .transaction(() =>
          Effect.gen(function* () {
            yield* db
              .select({ id: schema.organizationTable.id })
              .from(schema.organizationTable)
              .where(eq(schema.organizationTable.id, caller.organizationId))
              .for("no key update");

            yield* requireCrmEntryAllowance(caller.organizationId);

            return yield* companies.create(
              {
                avatar: avatar ?? null,
                externalCreatedAt: externalCreatedAt ?? null,
                externalId: externalId ?? null,
                name,
                organizationId: caller.organizationId,
              },
              { source: "API" }
            );
          })
        )
        .pipe(
          // The domain reports a name collision as a typed failure; the index
          // race that beats the pre-check is a driver error. Both answer on
          // the published `CONFLICT`.
          Effect.catchTag("CompanyAlreadyExistsError", () =>
            Effect.fail(conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE))
          ),
          withRemapDbErrors({
            action: "create",
            entity: "PublicApiCompany",
            onUniqueViolation: () =>
              conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE),
          }),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return toPublicApiCompany(toCompanySource(created));
    })
);

export const getCompanyOperation = defineOperation(
  "getCompany",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Read one company by id.",
    failure: COMPANY_READ_FAILURES,
    input: GetCompanyInput,
    output: PublicApiCompany,
    scope: "companies.read",
  },
  ({ companyId }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const companies = yield* CompanyRepository;

      const company = yield* companies
        .findById({ id: companyId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiCompany", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return yield* Option.match(company, {
        onNone: () => Effect.fail(notFoundError("Company not found.")),
        onSome: (found) =>
          Effect.succeed(toPublicApiCompany(toCompanySource(found))),
      });
    })
);

export const updateCompanyOperation = defineOperation(
  "updateCompany",
  {
    description: "Update the fields a company request names.",
    failure: COMPANY_UPDATE_FAILURES,
    input: UpdateCompanyInput,
    output: PublicApiCompany,
    scope: "companies.update",
  },
  ({ avatar, companyId, externalCreatedAt, externalId, name: rawName }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const companies = yield* CompanyRepository;

      // A body that names no field would otherwise be answered as a
      // successful write that changed nothing but `updatedAt`, which tells
      // the caller their request did something it did not. `null` is a
      // field being named, so a body that only clears an avatar is fine.
      const namesAField =
        rawName !== undefined ||
        externalId !== undefined ||
        avatar !== undefined ||
        externalCreatedAt !== undefined;

      if (!namesAField) {
        return yield* invalidRequestError(
          "Provide at least one field to update."
        );
      }

      const name = rawName === undefined ? null : yield* parseName(rawName);

      // The company is read before the write so another workspace's company
      // is a 404 rather than an update that matches no row and answers 200.
      const company = yield* companies
        .findById({ id: companyId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiCompany", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      if (Option.isNone(company)) {
        return yield* notFoundError("Company not found.");
      }

      yield* failIfCompanyIsTaken({
        excludeCompanyId: companyId,
        externalId: externalId ?? null,
        name,
        organizationId: caller.organizationId,
      });

      const updated = yield* companies
        .update({
          avatar,
          externalCreatedAt,
          externalId,
          id: companyId,
          // `null` means "not being written"; `undefined` leaves the column
          // alone.
          name: name ?? undefined,
          organizationId: caller.organizationId,
        })
        .pipe(
          withRemapDbErrors({
            action: "update",
            entity: "PublicApiCompany",
            onUniqueViolation: () =>
              conflictError(COMPANY_UNIQUE_VIOLATION_MESSAGE),
          }),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      // The read above cannot hold the row still, so a company deleted
      // between the two is answered as the missing company it is rather
      // than as a driver failure the caller cannot act on.
      return yield* Option.match(updated, {
        onNone: () => Effect.fail(notFoundError("Company not found.")),
        onSome: (found) =>
          Effect.succeed(toPublicApiCompany(toCompanySource(found))),
      });
    })
);

export const deleteCompanyOperation = defineOperation(
  "deleteCompany",
  {
    annotations: { destructive: true },
    description: "Delete a company; its contacts survive without it.",
    failure: COMPANY_DELETE_FAILURES,
    input: DeleteCompanyInput,
    output: Schema.Void,
    scope: "companies.delete",
  },
  ({ companyId }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const companies = yield* CompanyRepository;

      // A company that is already gone is a 404 rather than a success, for
      // the same reason as a tag: the caller cannot tell a delete that
      // worked from one that named the wrong workspace.
      const company = yield* companies
        .findById({ id: companyId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiCompany", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      if (Option.isNone(company)) {
        return yield* notFoundError("Company not found.");
      }

      const deleted = yield* companies
        .delete({ id: companyId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiCompany", "delete"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      // The read above cannot hold the row still, so a company deleted
      // between the two is answered as the missing company it is rather
      // than as a success that deleted nothing.
      if (Option.isNone(deleted)) {
        return yield* notFoundError("Company not found.");
      }

      return undefined;
    })
);

export const companyOperations = [
  listCompaniesOperation,
  createCompanyOperation,
  getCompanyOperation,
  updateCompanyOperation,
  deleteCompanyOperation,
] as const;
