import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { PublicApi } from "./api-contract";
import { currentPublicApiConfig } from "./config";
import { decodeCursor, encodeCursor } from "./cursor";
import { requireCrmEntryAllowance } from "./entitlement";
import {
  conflictError,
  internalError,
  invalidRequestError,
  notFoundError,
} from "./errors";
import {
  toPublicApiCompany,
  toPublicApiPost,
  toPublicApiPostSummary,
  toPublicApiTag,
  toPublicApiTagDetail,
} from "./mappers";
import { currentPublicApiCaller, requirePublicApiScope } from "./middleware";
import { currentPublicApiRepository } from "./repository";
import {
  PUBLIC_API_PAGE_DEFAULT_LIMIT,
  PUBLIC_API_PAGE_MAX_LIMIT,
  type TPublicApiCompanyPage,
  type TPublicApiPost,
  type TPublicApiPostPage,
  type TPublicApiPostTags,
  type TPublicApiTagPage,
} from "./schema";

const parseLimit = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return PUBLIC_API_PAGE_DEFAULT_LIMIT;
    }

    if (!/^\d+$/.test(raw)) {
      return yield* Effect.fail(
        invalidRequestError("limit must be a positive integer.")
      );
    }

    const limit = Number(raw);
    if (limit < 1 || limit > PUBLIC_API_PAGE_MAX_LIMIT) {
      return yield* Effect.fail(
        invalidRequestError(
          `limit must be between 1 and ${PUBLIC_API_PAGE_MAX_LIMIT}.`
        )
      );
    }

    return limit;
  });

const parseIncludeArchived = (raw: string | undefined) => {
  if (raw === undefined || raw.length === 0 || raw === "false") {
    return Effect.succeed(false);
  }
  if (raw === "true") {
    return Effect.succeed(true);
  }
  return Effect.fail(
    invalidRequestError("includeArchived must be true or false.")
  );
};

/**
 * Decodes the cursor, distinguishing "no cursor" from "a cursor I cannot read".
 *
 * Ignoring an unreadable cursor would silently return the first page forever,
 * so it is reported as `INVALID_REQUEST` instead.
 */
const parseCursor = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return null;
    }

    const decoded = Option.getOrNull(decodeCursor(raw));
    if (decoded === null) {
      return yield* Effect.fail(
        invalidRequestError("cursor is not a valid page cursor.")
      );
    }

    return decoded;
  });

/**
 * Tag and company names are trimmed before they are stored or compared.
 *
 * Without this, `" UI "` and `"UI"` are two different names that produce the
 * same tag slug, so the second one is rejected by an index the caller cannot
 * see; and a company named `" Acme "` would sit beside `"Acme"` until someone
 * looked. An all-whitespace name is not a name at all.
 */
const parseName = (raw: string) =>
  Effect.gen(function* () {
    const name = raw.trim();
    if (name.length === 0) {
      return yield* Effect.fail(invalidRequestError("name must not be empty."));
    }
    return name;
  });

/** The same message for both the pre-check and the index race that beats it. */
const TAG_NAME_CONFLICT = "A tag with this name already exists.";

/**
 * The pre-check's messages, one per colliding field.
 *
 * The index race that beats the pre-check is reported by the repository
 * instead, which cannot say which of the two indexes was violated — see
 * `COMPANY_UNIQUE_VIOLATION_MESSAGE`.
 */
const COMPANY_NAME_CONFLICT = "A company with this name already exists.";

const COMPANY_EXTERNAL_ID_CONFLICT =
  "A company with this externalId already exists.";

/**
 * The repository's driver failure, answered on the published vocabulary.
 *
 * `withRemapDbErrors` turns a driver failure into the domain's
 * `InternalServerError`; the code a caller switches on is this API's own
 * `INTERNAL_ERROR`, so renaming an internal error cannot change the published
 * body. The message is fixed for the same reason — a driver message can carry
 * a constraint name or a row.
 */
const onInternalError = () =>
  Effect.fail(internalError("The request could not be completed."));

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
    const repository = yield* currentPublicApiRepository;
    const existing = yield* repository
      .findTagNameConflict(args)
      .pipe(Effect.catchTag("InternalServerError", onInternalError));

    if (Option.isSome(existing)) {
      return yield* Effect.fail(conflictError(TAG_NAME_CONFLICT));
    }
  });

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
    const repository = yield* currentPublicApiRepository;

    if (args.name !== null) {
      const nameTaken = yield* repository
        .findCompanyNameConflict({
          excludeCompanyId: args.excludeCompanyId,
          name: args.name,
          organizationId: args.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", onInternalError));

      if (Option.isSome(nameTaken)) {
        return yield* Effect.fail(conflictError(COMPANY_NAME_CONFLICT));
      }
    }

    if (args.externalId === null) {
      return;
    }

    const externalIdTaken = yield* repository
      .findCompanyExternalIdConflict({
        excludeCompanyId: args.excludeCompanyId,
        externalId: args.externalId,
        organizationId: args.organizationId,
      })
      .pipe(Effect.catchTag("InternalServerError", onInternalError));

    if (Option.isSome(externalIdTaken)) {
      return yield* Effect.fail(conflictError(COMPANY_EXTERNAL_ID_CONFLICT));
    }
  });

export const PublicApiLive = HttpApiBuilder.group(
  PublicApi,
  "PublicApiV1",
  (handlers) =>
    handlers
      .handle("listBoardPosts", ({ params, query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);
          const includeArchived = yield* parseIncludeArchived(
            query.includeArchived
          );

          const page = yield* repository
            .listBoardPosts({
              boardId: params.boardId,
              cursor,
              includeArchived,
              limit,
              organizationId: caller.organizationId,
              statusId: query.status ?? null,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(page, {
            // Not found rather than an empty page: a missing board and an
            // empty board must not look the same, and another workspace's
            // board is reported as missing so the id cannot probe at all.
            onNone: () => Effect.fail(notFoundError("Board not found.")),
            onSome: (found) => {
              const mapperContext = {
                appUrl: config.appUrl,
                organizationId: caller.organizationId,
              } as const;

              return Effect.succeed({
                data: found.posts.map((post) =>
                  toPublicApiPostSummary(post, mapperContext)
                ),
                nextCursor:
                  found.nextCursor === null
                    ? null
                    : encodeCursor(found.nextCursor),
              } satisfies TPublicApiPostPage);
            },
          });
        })
      )
      .handle("getPost", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.read");

          const post = yield* repository
            .findPost({
              organizationId: caller.organizationId,
              postId: params.postId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(post, {
            // Not found rather than forbidden for another workspace's post: a
            // 403 would confirm that the id exists somewhere.
            onNone: () => Effect.fail(notFoundError("Post not found.")),
            onSome: (found) =>
              Effect.succeed(
                toPublicApiPost(found, {
                  appUrl: config.appUrl,
                  organizationId: caller.organizationId,
                }) satisfies TPublicApiPost
              ),
          });
        })
      )
      .handle("setPostTags", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.assign");

          // The post is read and locked inside the write's own transaction, so
          // another workspace's post is a 404, a post deleted mid-request is a
          // 404 rather than a foreign-key failure, and two replacements of one
          // post's tags cannot interleave into a set neither caller asked for.
          const tags = yield* repository
            .setPostTags({
              organizationId: caller.organizationId,
              postId: params.postId,
              tagIds: payload.tagIds,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: tags.map(toPublicApiTag),
          } satisfies TPublicApiPostTags;
        })
      )
      .handle("listTags", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);

          // No existence check: the key proves the workspace exists, and a
          // workspace with no tags is an empty page rather than a 404.
          const page = yield* repository
            .listTags({
              cursor,
              limit,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: page.tags.map(toPublicApiTagDetail),
            nextCursor:
              page.nextCursor === null ? null : encodeCursor(page.nextCursor),
          } satisfies TPublicApiTagPage;
        })
      )
      .handle("createTag", ({ payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.create");

          const name = yield* parseName(payload.name);

          yield* failIfTagNameIsTaken({
            excludeTagId: null,
            name,
            organizationId: caller.organizationId,
          });

          const created = yield* repository
            .createTag({ name, organizationId: caller.organizationId })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiTagDetail(created);
        })
      )
      .handle("getTag", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.read");

          const tag = yield* repository
            .findTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(tag, {
            onNone: () => Effect.fail(notFoundError("Tag not found.")),
            onSome: (found) => Effect.succeed(toPublicApiTagDetail(found)),
          });
        })
      )
      .handle("updateTag", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.update");

          const name = yield* parseName(payload.name);

          // The tag is read before the rename so another workspace's tag is a
          // 404 rather than an update that matches no row and answers 200.
          const tag = yield* repository
            .findTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(tag)) {
            return yield* Effect.fail(notFoundError("Tag not found."));
          }

          yield* failIfTagNameIsTaken({
            excludeTagId: params.tagId,
            name,
            organizationId: caller.organizationId,
          });

          const updated = yield* repository
            .updateTag({
              name,
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiTagDetail(updated);
        })
      )
      .handle("deleteTag", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.delete");

          // Deleting a tag that is already gone is a 404 rather than a
          // success: the caller cannot tell a delete that worked from one
          // that named the wrong workspace, and the second is worth knowing.
          const tag = yield* repository
            .findTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(tag)) {
            return yield* Effect.fail(notFoundError("Tag not found."));
          }

          yield* repository
            .deleteTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));
        })
      )
      .handle("listCompanies", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);

          // No existence check: the key proves the workspace exists, and a
          // workspace with no companies is an empty page rather than a 404.
          const page = yield* repository
            .listCompanies({
              cursor,
              limit,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: page.companies.map(toPublicApiCompany),
            nextCursor:
              page.nextCursor === null ? null : encodeCursor(page.nextCursor),
          } satisfies TPublicApiCompanyPage;
        })
      )
      .handle("createCompany", ({ payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.create");

          const name = yield* parseName(payload.name);

          yield* failIfCompanyIsTaken({
            excludeCompanyId: null,
            externalId: payload.externalId ?? null,
            name,
            organizationId: caller.organizationId,
          });

          // After the conflict checks, so a duplicate create is answered as the
          // conflict it is rather than as a plan problem the caller cannot act
          // on, and before the insert, so the workspace never holds one more
          // CRM entry than its plan allows.
          yield* requireCrmEntryAllowance(caller.organizationId);

          const created = yield* repository
            .createCompany({
              avatar: payload.avatar ?? null,
              externalCreatedAt: payload.externalCreatedAt ?? null,
              externalId: payload.externalId ?? null,
              name,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiCompany(created);
        })
      )
      .handle("getCompany", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.read");

          const company = yield* repository
            .findCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(company, {
            onNone: () => Effect.fail(notFoundError("Company not found.")),
            onSome: (found) => Effect.succeed(toPublicApiCompany(found)),
          });
        })
      )
      .handle("updateCompany", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.update");

          // A body that names no field would otherwise be answered as a
          // successful write that changed nothing but `updatedAt`, which tells
          // the caller their request did something it did not. `null` is a
          // field being named, so a body that only clears an avatar is fine.
          const namesAField =
            payload.name !== undefined ||
            payload.externalId !== undefined ||
            payload.avatar !== undefined ||
            payload.externalCreatedAt !== undefined;

          if (!namesAField) {
            return yield* Effect.fail(
              invalidRequestError("Provide at least one field to update.")
            );
          }

          const name =
            payload.name === undefined ? null : yield* parseName(payload.name);

          // The company is read before the write so another workspace's
          // company is a 404 rather than an update that matches no row and
          // answers 200.
          const company = yield* repository
            .findCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(company)) {
            return yield* Effect.fail(notFoundError("Company not found."));
          }

          yield* failIfCompanyIsTaken({
            excludeCompanyId: params.companyId,
            externalId: payload.externalId ?? null,
            name,
            organizationId: caller.organizationId,
          });

          const updated = yield* repository
            .updateCompany({
              avatar: payload.avatar,
              companyId: params.companyId,
              externalCreatedAt: payload.externalCreatedAt,
              externalId: payload.externalId,
              // `null` means "not being written"; the repository's `undefined`
              // is what leaves the column alone.
              name: name ?? undefined,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiCompany(updated);
        })
      )
      .handle("deleteCompany", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.delete");

          // A company that is already gone is a 404 rather than a success, for
          // the same reason as a tag: the caller cannot tell a delete that
          // worked from one that named the wrong workspace.
          const company = yield* repository
            .findCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(company)) {
            return yield* Effect.fail(notFoundError("Company not found."));
          }

          yield* repository
            .deleteCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));
        })
      )
);
