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
  conflictError,
  internalError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { parseName } from "../../public-api/parse";
import { withRemapDbErrors } from "../../rpc-errors";
import { currentTagRepository } from "../../tag/repository";
import { toPublicApiTagDetail, toTagSource } from "./mappers";
import {
  CreateTagInput,
  DeleteTagInput,
  GetTagInput,
  ListTagsInput,
  PublicApiTagDetail,
  PublicApiTagPage,
  UpdateTagInput,
} from "./schema";

/** The same message for both the pre-check and the index race that beats it. */
const TAG_NAME_CONFLICT = "A tag with this name already exists.";

/** The read vocabulary: a tag read cannot collide with anything. */
const TAG_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/** A create can collide with an existing name, but cannot report a missing row. */
const TAG_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  ConflictError,
  InternalError,
]);

/** A rename reads the row first, so it can be missing and can collide. */
const TAG_RENAME_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
]);

/** A delete can report a missing row, but never collides. */
const TAG_DELETE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * Rejects a name another tag in the workspace already holds.
 *
 * A courtesy to the caller, not the authority: the unique index is, and the
 * write maps its violation to the same conflict. Checking first means an
 * ordinary duplicate is answered with a message about the name rather than a
 * driver error the caller cannot act on. `excludeTagId` is what lets a tag
 * keep its own name through a rename.
 */
const failIfTagNameIsTaken = (args: {
  readonly excludeTagId: string | null;
  readonly name: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const tags = yield* currentTagRepository;
    const existing = yield* tags.findNameConflict(args).pipe(
      withRemapDbErrors("PublicApiTag", "select"),
      Effect.catchTag("InternalServerError", () => onInternalError)
    );

    if (Option.isSome(existing)) {
      return yield* conflictError(TAG_NAME_CONFLICT);
    }

    return undefined;
  });

/**
 * The tag operations.
 *
 * Each is the whole behavior of one tag endpoint, independent of HTTP: it
 * takes typed input, enforces its own scope, and answers with the published
 * DTO. `./http.ts` is the endpoint projection of these, and a future MCP
 * projection derives tools from the same records — so the two surfaces cannot
 * drift into different answers for the same call.
 *
 * The row writes are `TagRepository`'s own; what is public-specific is the
 * cursor paging, the pre-checks that name the colliding field, and the
 * published error vocabulary.
 */

export const listTagsOperation = defineOperation(
  "listTags",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "List the workspace's tags, newest first.",
    failure: TAG_READ_FAILURES,
    input: ListTagsInput,
    output: PublicApiTagPage,
    scope: "tags.read",
  },
  ({ cursor, limit }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const tags = yield* currentTagRepository;

      const after = yield* decodeCursorOrFail(cursor);
      const pageSize = limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT;

      const rows = yield* tags
        .findPage({
          after,
          limit: pageSize,
          organizationId: caller.organizationId,
        })
        .pipe(
          withRemapDbErrors("PublicApiTag", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const lastRow = pageRows.at(-1);

      return {
        data: pageRows.map((row) => toPublicApiTagDetail(toTagSource(row))),
        nextCursor:
          hasMore && lastRow !== undefined
            ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
            : null,
      };
    })
);

export const createTagOperation = defineOperation(
  "createTag",
  {
    description: "Create a tag in the calling workspace.",
    failure: TAG_CREATE_FAILURES,
    input: CreateTagInput,
    output: PublicApiTagDetail,
    scope: "tags.create",
  },
  ({ name: rawName }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const tags = yield* currentTagRepository;

      const name = yield* parseName(rawName);

      yield* failIfTagNameIsTaken({
        excludeTagId: null,
        name,
        organizationId: caller.organizationId,
      });

      const created = yield* tags
        .create({ name, organizationId: caller.organizationId })
        .pipe(
          // An insert either stores a row or fails; the domain reports the
          // broken invariant as its own failure, which is not a
          // caller-actionable state and is published as `INTERNAL_ERROR`.
          Effect.catchTag("FailedToCreateTagError", () =>
            Effect.fail(internalError())
          ),
          withRemapDbErrors({
            action: "create",
            entity: "PublicApiTag",
            onUniqueViolation: () => conflictError(TAG_NAME_CONFLICT),
          }),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return toPublicApiTagDetail(toTagSource(created));
    })
);

export const getTagOperation = defineOperation(
  "getTag",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Read one tag by id.",
    failure: TAG_READ_FAILURES,
    input: GetTagInput,
    output: PublicApiTagDetail,
    scope: "tags.read",
  },
  ({ tagId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const tags = yield* currentTagRepository;

      const tag = yield* tags
        .findById({ id: tagId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiTag", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return yield* Option.match(tag, {
        onNone: () => Effect.fail(notFoundError("Tag not found.")),
        onSome: (found) =>
          Effect.succeed(toPublicApiTagDetail(toTagSource(found))),
      });
    })
);

export const updateTagOperation = defineOperation(
  "updateTag",
  {
    description: "Rename a tag; the slug is re-derived from the name.",
    failure: TAG_RENAME_FAILURES,
    input: UpdateTagInput,
    output: PublicApiTagDetail,
    scope: "tags.update",
  },
  ({ name: rawName, tagId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const tags = yield* currentTagRepository;

      const name = yield* parseName(rawName);

      // The tag is read before the rename so another workspace's tag is a
      // 404 rather than an update that matches no row and answers 200.
      const tag = yield* tags
        .findById({ id: tagId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiTag", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      if (Option.isNone(tag)) {
        return yield* notFoundError("Tag not found.");
      }

      yield* failIfTagNameIsTaken({
        excludeTagId: tagId,
        name,
        organizationId: caller.organizationId,
      });

      const updated = yield* tags
        .update({ id: tagId, name, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors({
            action: "update",
            entity: "PublicApiTag",
            onUniqueViolation: () => conflictError(TAG_NAME_CONFLICT),
          }),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      return yield* Option.match(updated, {
        // The read above cannot hold the row still, so a tag deleted between
        // the two is answered as the missing tag it is rather than as a
        // success that renamed nothing.
        onNone: () => Effect.fail(notFoundError("Tag not found.")),
        onSome: (found) =>
          Effect.succeed(toPublicApiTagDetail(toTagSource(found))),
      });
    })
);

export const deleteTagOperation = defineOperation(
  "deleteTag",
  {
    annotations: { destructive: true },
    description: "Delete a tag and remove it from every post that carried it.",
    failure: TAG_DELETE_FAILURES,
    input: DeleteTagInput,
    output: Schema.Void,
    scope: "tags.delete",
  },
  ({ tagId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const tags = yield* currentTagRepository;

      // Deleting a tag that is already gone is a 404 rather than a success:
      // the caller cannot tell a delete that worked from one that named the
      // wrong workspace, and the second is worth knowing.
      const tag = yield* tags
        .findById({ id: tagId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiTag", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      if (Option.isNone(tag)) {
        return yield* notFoundError("Tag not found.");
      }

      const deleted = yield* tags
        .delete({ id: tagId, organizationId: caller.organizationId })
        .pipe(
          withRemapDbErrors("PublicApiTag", "delete"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      if (!deleted) {
        return yield* notFoundError("Tag not found.");
      }

      return undefined;
    })
);

export const tagOperations = [
  listTagsOperation,
  createTagOperation,
  getTagOperation,
  updateTagOperation,
  deleteTagOperation,
] as const;
