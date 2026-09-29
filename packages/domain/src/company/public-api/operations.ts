import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { parseName } from "../../public-api/parse";
import { toPublicApiCompany } from "./mappers";
import { currentPublicApiCompanyRepository } from "./repository";
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
 * The index race that beats the pre-check is reported by the repository
 * instead, which cannot say which of the two indexes was violated — see
 * `COMPANY_UNIQUE_VIOLATION_MESSAGE` there.
 */
const COMPANY_NAME_CONFLICT = "A company with this name already exists.";

const COMPANY_EXTERNAL_ID_CONFLICT =
  "A company with this externalId already exists.";

/**
 * Rejects a name, or an external id, another company in the workspace holds.
 *
 * A courtesy to the caller, not the authority: the two unique indexes are, and
 * the repository maps their violation to the same conflict. Checking first
 * means an ordinary duplicate is answered with a message about the field that
 * actually collided, which is the difference between "rename it" and "that
 * sync id is already in use" for a caller that has to decide what to do next.
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
    const repository = yield* currentPublicApiCompanyRepository;

    if (args.name !== null) {
      const nameTaken = yield* repository
        .findNameConflict({
          excludeCompanyId: args.excludeCompanyId,
          name: args.name,
          organizationId: args.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isSome(nameTaken)) {
        return yield* conflictError(COMPANY_NAME_CONFLICT);
      }
    }

    if (args.externalId === null) {
      return undefined;
    }

    const externalIdTaken = yield* repository
      .findExternalIdConflict({
        excludeCompanyId: args.excludeCompanyId,
        externalId: args.externalId,
        organizationId: args.organizationId,
      })
      .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

    if (Option.isSome(externalIdTaken)) {
      return yield* conflictError(COMPANY_EXTERNAL_ID_CONFLICT);
    }

    return undefined;
  });

/**
 * The company operations.
 *
 * The writes are `CompanyRepository`'s own, with the plan's room check run
 * inside the same transaction that holds the workspace lock, so the Public API
 * and the dashboard cannot disagree about what the CRM limit means.
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
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCompanyRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .list({
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return {
        data: page.companies.map(toPublicApiCompany),
        nextCursor:
          page.nextCursor === null ? null : encodeCursor(page.nextCursor),
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
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCompanyRepository;

      const name = yield* parseName(rawName);

      yield* failIfCompanyIsTaken({
        excludeCompanyId: null,
        externalId: externalId ?? null,
        name,
        organizationId: caller.organizationId,
      });

      // The plan gate and the insert are one call, and one transaction: the
      // repository locks the workspace, runs this check, and only then
      // writes, so two creates arriving near a plan's cap cannot both see
      // room. See `create`.
      const created = yield* repository
        .create({
          avatar: avatar ?? null,
          ensureRoom: requireCrmEntryAllowance(caller.organizationId),
          externalCreatedAt: externalCreatedAt ?? null,
          externalId: externalId ?? null,
          name,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return toPublicApiCompany(created);
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
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCompanyRepository;

      const company = yield* repository
        .find({ companyId, organizationId: caller.organizationId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(company, {
        onNone: () => Effect.fail(notFoundError("Company not found.")),
        onSome: (found) => Effect.succeed(toPublicApiCompany(found)),
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
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCompanyRepository;

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
      const company = yield* repository
        .find({ companyId, organizationId: caller.organizationId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(company)) {
        return yield* notFoundError("Company not found.");
      }

      yield* failIfCompanyIsTaken({
        excludeCompanyId: companyId,
        externalId: externalId ?? null,
        name,
        organizationId: caller.organizationId,
      });

      const updated = yield* repository
        .update({
          avatar,
          companyId,
          externalCreatedAt,
          externalId,
          // `null` means "not being written"; the repository's `undefined`
          // is what leaves the column alone.
          name: name ?? undefined,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      // The read above cannot hold the row still, so a company deleted
      // between the two is answered as the missing company it is rather
      // than as a driver failure the caller cannot act on.
      return yield* Option.match(updated, {
        onNone: () => Effect.fail(notFoundError("Company not found.")),
        onSome: (found) => Effect.succeed(toPublicApiCompany(found)),
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
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCompanyRepository;

      // A company that is already gone is a 404 rather than a success, for
      // the same reason as a tag: the caller cannot tell a delete that
      // worked from one that named the wrong workspace.
      const company = yield* repository
        .find({ companyId, organizationId: caller.organizationId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(company)) {
        return yield* notFoundError("Company not found.");
      }

      const deleted = yield* repository
        .delete({ companyId, organizationId: caller.organizationId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      // The read above cannot hold the row still, so a company deleted
      // between the two is answered as the missing company it is rather
      // than as a success that deleted nothing.
      if (!deleted) {
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
