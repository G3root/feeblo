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
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { parseName } from "../../public-api/parse";
import { toPublicApiTag, toPublicApiTagDetail } from "./mappers";
import { currentPublicApiTagRepository } from "./repository";
import {
  CreateTagInput,
  DeleteTagInput,
  GetTagInput,
  ListTagsInput,
  PublicApiPostTags,
  PublicApiTagDetail,
  PublicApiTagPage,
  SetPostTagsInput,
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

/** A delete or a tag assignment can report a missing row, but never collides. */
const TAG_DELETE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * Rejects a name another tag in the workspace already holds.
 *
 * A courtesy to the caller, not the authority: the unique index is, and the
 * repository maps its violation to the same conflict. Checking first means an
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
    const repository = yield* currentPublicApiTagRepository;
    const existing = yield* repository
      .findNameConflict(args)
      .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

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
 * DTO. `../tag/http.ts` is the endpoint projection of these, and a future MCP
 * projection derives tools from the same records — so the two surfaces cannot
 * drift into different answers for the same call.
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
      const repository = yield* currentPublicApiTagRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .list({
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return {
        data: page.tags.map(toPublicApiTagDetail),
        nextCursor:
          page.nextCursor === null ? null : encodeCursor(page.nextCursor),
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
      const repository = yield* currentPublicApiTagRepository;

      const name = yield* parseName(rawName);

      yield* failIfTagNameIsTaken({
        excludeTagId: null,
        name,
        organizationId: caller.organizationId,
      });

      const created = yield* repository
        .create({ name, organizationId: caller.organizationId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return toPublicApiTagDetail(created);
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
      const repository = yield* currentPublicApiTagRepository;

      const tag = yield* repository
        .find({ organizationId: caller.organizationId, tagId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(tag, {
        onNone: () => Effect.fail(notFoundError("Tag not found.")),
        onSome: (found) => Effect.succeed(toPublicApiTagDetail(found)),
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
      const repository = yield* currentPublicApiTagRepository;

      const name = yield* parseName(rawName);

      // The tag is read before the rename so another workspace's tag is a
      // 404 rather than an update that matches no row and answers 200.
      const tag = yield* repository
        .find({ organizationId: caller.organizationId, tagId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(tag)) {
        return yield* notFoundError("Tag not found.");
      }

      yield* failIfTagNameIsTaken({
        excludeTagId: tagId,
        name,
        organizationId: caller.organizationId,
      });

      const updated = yield* repository
        .update({ name, organizationId: caller.organizationId, tagId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(updated, {
        // The read above cannot hold the row still, so a tag deleted between
        // the two is answered as the missing tag it is rather than as a
        // success that renamed nothing.
        onNone: () => Effect.fail(notFoundError("Tag not found.")),
        onSome: (found) => Effect.succeed(toPublicApiTagDetail(found)),
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
      const repository = yield* currentPublicApiTagRepository;

      // Deleting a tag that is already gone is a 404 rather than a success:
      // the caller cannot tell a delete that worked from one that named the
      // wrong workspace, and the second is worth knowing.
      const tag = yield* repository
        .find({ organizationId: caller.organizationId, tagId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(tag)) {
        return yield* notFoundError("Tag not found.");
      }

      const deleted = yield* repository
        .delete({ organizationId: caller.organizationId, tagId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (!deleted) {
        return yield* notFoundError("Tag not found.");
      }

      return undefined;
    })
);

export const setPostTagsOperation = defineOperation(
  "setPostTags",
  {
    description: "Replace the complete set of tags a post carries.",
    failure: TAG_DELETE_FAILURES,
    input: SetPostTagsInput,
    output: PublicApiPostTags,
    scope: "tags.assign",
  },
  ({ postId, tagIds }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiTagRepository;

      // The post is read and locked inside the write's own transaction, so
      // another workspace's post is a 404, a post deleted mid-request is a
      // 404 rather than a foreign-key failure, and two replacements of one
      // post's tags cannot interleave into a set neither caller asked for.
      const tags = yield* repository
        .setPostTags({
          organizationId: caller.organizationId,
          postId,
          tagIds,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return { data: tags.map(toPublicApiTag) };
    })
);

export const tagOperations = [
  listTagsOperation,
  createTagOperation,
  getTagOperation,
  updateTagOperation,
  deleteTagOperation,
  setPostTagsOperation,
] as const;
