import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  PlanRequiresUpgradeError,
  invalidRequestError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { PublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { toPublicApiEndUser } from "./mappers";
import { PublicApiEndUserRepository } from "./repository";
import {
  GetEndUserInput,
  ListEndUsersInput,
  PublicApiEndUser,
  PublicApiEndUserPage,
  UpsertEndUserInput,
} from "./schema";

const END_USER_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * A write can be refused by an identifier that names a different end user or
 * by a plan with no room left for another CRM entry, so it publishes the
 * conflict and the plan refusal alongside the base vocabulary.
 */
const END_USER_WRITE_FAILURES = Schema.Union([
  InvalidRequestError,
  ConflictError,
  PlanRequiresUpgradeError,
  InternalError,
]);

/**
 * The end-user operations.
 *
 * An end user is the workspace's own record of a customer. Reading the roster
 * is opt-in (`end_users.read`) like reading companies, because it is a record
 * about the workspace's customers rather than the workspace's content; the
 * upsert exists so a sync can create the customer before the post, comment, or
 * vote that names them, and re-run without making a second person.
 *
 * The write is not the on-behalf resolver: that path creates a contact as a
 * side effect of attributing something to it, while this endpoint is the
 * caller saying who the person is. Both write the same row, so a customer
 * created here is the customer a later vote attaches to.
 */

export const listEndUsersOperation = defineOperation(
  "listEndUsers",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List the workspace's end users, newest first, as a cursor-paginated page. Each carries the contact id, the caller's own external id, the display name and avatar, and the company it belongs to — never an email address.",
    failure: END_USER_READ_FAILURES,
    input: ListEndUsersInput,
    output: PublicApiEndUserPage,
    scope: "end_users.read",
  },
  ({ companyId, cursor, email, externalId, limit }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiEndUserRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .listEndUsers({
          companyId: companyId ?? null,
          cursor: after,
          email: email ?? null,
          externalId: externalId ?? null,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return {
        data: page.users.map(toPublicApiEndUser),
        nextCursor:
          page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      };
    })
);

export const getEndUserOperation = defineOperation(
  "getEndUser",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "Read one end user by the contact id the list returns. An id of another workspace is reported as not found.",
    failure: END_USER_READ_FAILURES,
    input: GetEndUserInput,
    output: PublicApiEndUser,
    scope: "end_users.read",
  },
  ({ endUserId }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiEndUserRepository;

      const found = yield* repository
        .findEndUser({
          endUserId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(found, {
        onNone: () => Effect.fail(notFoundError("End user not found.")),
        onSome: (endUser) => Effect.succeed(toPublicApiEndUser(endUser)),
      });
    })
);

export const upsertEndUserOperation = defineOperation(
  "upsertEndUser",
  {
    annotations: { idempotent: true },
    description:
      "Create or update one end user, keyed by external id and email. An absent field is left alone, an explicit null clears a nullable one, and two identifiers that name different end users are refused with CONFLICT.",
    failure: END_USER_WRITE_FAILURES,
    input: UpsertEndUserInput,
    output: PublicApiEndUser,
    scope: "end_users.write",
  },
  ({ avatarUrl, companyId, email, externalId, name }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiEndUserRepository;

      // Without one of these there is no key to match on, so a second request
      // would silently create a second person. The check lives here rather
      // than in the schema because a null and an absent field mean different
      // things — null clears, absent leaves alone — and only the combination
      // "neither is set" is invalid.
      const hasExternalId = externalId !== undefined && externalId !== null;
      const hasEmail = email !== undefined && email !== null;
      if (!(hasExternalId || hasEmail)) {
        return yield* invalidRequestError(
          "Provide an externalId or an email so the end user can be matched."
        );
      }

      const endUser = yield* repository
        .upsertEndUser({
          avatarUrl,
          companyId,
          email,
          externalId,
          name,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return toPublicApiEndUser(endUser);
    })
);

export const endUserOperations = [
  listEndUsersOperation,
  getEndUserOperation,
  upsertEndUserOperation,
] as const;
