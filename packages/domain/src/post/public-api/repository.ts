import { currentDb, Database, schema } from "@feeblo/db";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { PostId } from "@feeblo/id";
import { IntegrationEventRecorder } from "@feeblo/integration-core";
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { EmailOutboxConfig } from "../../email-outbox/config";
import { EmailSubscriptionRepository } from "../../email-subscription/repository";
import {
  CrmEntryLimitReachedError,
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../../identity/errors";
import { ResolvePrincipalService } from "../../identity/service";
import * as Policy from "../../policy";
import type { TPublicApiOnBehalfAuthor } from "../../public-api/common";
import type { Cursor } from "../../public-api/cursor";
import { crmLimitMessage } from "../../public-api/entitlement";
import {
  ConflictError,
  conflictError,
  InternalError,
  internalError,
  InvalidRequestError,
  invalidRequestError,
  NotFoundError,
  notFoundError,
  PlanRequiresUpgradeError,
  planRequiresUpgradeError,
} from "../../public-api/errors";
import { BadRequestError, withRemapDbErrors } from "../../rpc-errors";
import { S3UploadService } from "../../services/s3";
import type { PublicApiPostTag } from "../../tag/public-api/mappers";
import { UserRepository } from "../../user/repository";
import {
  FailedToCreatePostError,
  FailedToDeletePostError,
  FailedToMergePostError,
  FailedToUpdatePostError,
  PostAlreadyExistsError,
  PostNotFoundError,
} from "../errors";
import { PostRepository } from "../repository";
import { makePostWrites } from "../write";

/** An author reduced to a classification and display fields — never an id. */
export type PublicApiPostAuthor = {
  readonly type: "member" | "end_user";
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
};

/**
 * What a mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept a
 * dashboard row (which carries internal actor ids) and pass it through, and a
 * column added to the `post` table cannot reach a public response without being
 * added here first.
 */
export type PublicApiPostSource = {
  readonly id: string;
  readonly boardId: string;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly etaQuarter: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly lockedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly mergedIntoPostId: string | null;
  readonly status: {
    readonly id: string;
    readonly name: string;
    readonly type: TPostStatusType;
  };
  readonly author: PublicApiPostAuthor;
  readonly voteCount: number;
  readonly commentCount: number;
  readonly tags: readonly PublicApiPostTag[];
};

export type PublicApiListedPost = PublicApiPostSource & {
  readonly boardSlug: string;
};

export type PublicApiDetailedPost = PublicApiPostSource & {
  readonly boardSlug: string;
  readonly content: string;
};

export type PublicApiPostPage = {
  readonly posts: readonly PublicApiListedPost[];
  readonly nextCursor: Cursor | null;
};

/**
 * The post column list, and the only place a post field is selected from.
 *
 * The author classification is computed in SQL: `creatorMemberId` decides
 * whether an author is workspace staff or an outside end user, and it is an
 * internal identifier that must not leave the database. Reducing it to a
 * literal here — rather than selecting it and branching in TypeScript — keeps
 * the identifier out of the result set, out of logs, and out of any error
 * message that might embed a row.
 */
const POST_COLUMNS = {
  id: schema.postTable.id,
  boardId: schema.postTable.boardId,
  boardSlug: schema.boardTable.slug,
  title: schema.postTable.title,
  slug: schema.postTable.slug,
  excerpt: schema.postTable.excerpt,
  etaQuarter: schema.postTable.etaQuarter,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  statusId: schema.postStatusTable.id,
  // User-facing label; a workspace may leave it empty until it customizes the
  // status, in which case the mapper falls back to the canonical type.
  statusLabel: schema.postStatusTable.label,
  statusType: schema.postStatusTable.type,
  authorType: sql<
    "member" | "end_user"
  >`case when ${schema.postTable.creatorMemberId} is null then 'end_user' else 'member' end`,
  // Contact fallback mirrors the dashboard so a widget submission shows the
  // customer's name; the portal deliberately omits it because it serves
  // unauthenticated visitors. A Public API caller is the workspace itself.
  authorName: sql<
    string | null
  >`coalesce(${schema.userTable.name}, ${schema.contactTable.name})`,
  authorAvatarUrl: sql<
    string | null
  >`coalesce(${schema.userTable.image}, ${schema.contactTable.avatar})`,
} as const;

type PostRow = {
  id: string;
  boardId: string;
  boardSlug: string;
  title: string;
  slug: string;
  excerpt: string;
  etaQuarter: string | null;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  archivedAt: Date | null;
  mergedIntoPostId: string | null;
  statusId: string;
  statusLabel: string;
  statusType: TPostStatusType;
  authorType: "member" | "end_user";
  authorName: string | null;
  authorAvatarUrl: string | null;
};

const toSource = (
  row: PostRow,
  counts: { voteCount: number; commentCount: number },
  tags: readonly PublicApiPostTag[]
): PublicApiPostSource => ({
  id: row.id,
  boardId: row.boardId,
  title: row.title,
  slug: row.slug,
  excerpt: row.excerpt,
  etaQuarter: row.etaQuarter,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  lockedAt: row.lockedAt,
  archivedAt: row.archivedAt,
  mergedIntoPostId: row.mergedIntoPostId,
  status: { id: row.statusId, name: row.statusLabel, type: row.statusType },
  author: {
    type: row.authorType,
    displayName: row.authorName,
    avatarUrl: row.authorAvatarUrl,
  },
  voteCount: counts.voteCount,
  commentCount: counts.commentCount,
  tags,
});

/**
 * Translates the shared post write path's failures onto the published codes.
 *
 * The path fails in the domain's vocabulary; the Public API publishes its own.
 * Translating at this boundary is what keeps an internal error rename from
 * changing what a caller switches on, and it is total: anything this does not
 * name is an internal failure rather than a type the endpoint never declared.
 *
 * A failure that is already one of this API's own errors passes through — the
 * delete path reads the post before writing it and raises `NOT_FOUND` itself.
 */
const toPublicPostWriteError = (
  cause: unknown
):
  | InternalError
  | InvalidRequestError
  | NotFoundError
  | ConflictError
  | PlanRequiresUpgradeError => {
  if (Schema.is(NotFoundError)(cause)) return cause;
  if (Schema.is(InvalidRequestError)(cause)) return cause;
  if (Schema.is(ConflictError)(cause)) return cause;
  if (Schema.is(InternalError)(cause)) return cause;
  if (Schema.is(PlanRequiresUpgradeError)(cause)) return cause;
  // Naming an author with no contact yet makes the write provision one, which
  // is a CRM entry like any other and is capped like any other. Same remedy as
  // the company create's limit, so it answers with that code.
  if (Schema.is(CrmEntryLimitReachedError)(cause)) {
    return planRequiresUpgradeError(crmLimitMessage);
  }
  if (Schema.is(BadRequestError)(cause)) {
    return invalidRequestError(cause.message ?? "The request is not valid.");
  }
  if (Schema.is(PostAlreadyExistsError)(cause)) {
    return conflictError("A post with this slug already exists.");
  }
  if (Schema.is(PostNotFoundError)(cause)) {
    return notFoundError("Post not found.");
  }
  // The on-behalf subject a create or an update names can fail to resolve;
  // that is the caller's input, and the message is fixed because the identity
  // failures carry the subject id in their detail.
  if (Schema.is(InvalidSubjectError)(cause)) {
    return invalidRequestError(
      "The post's author could not be resolved in this workspace."
    );
  }
  if (Schema.is(SubjectNotFoundError)(cause)) {
    return invalidRequestError(
      "The post's author could not be found in this workspace."
    );
  }
  if (
    Schema.is(FailedToCreatePostError)(cause) ||
    Schema.is(FailedToDeletePostError)(cause)
  ) {
    return internalError();
  }
  if (Schema.is(FailedToUpdatePostError)(cause)) {
    // The shared update path fails this way when the row it locked to read the
    // post's previous state is gone: the post was deleted between the request
    // and the write. A missing resource is what the endpoint documents.
    return notFoundError("Post not found.");
  }
  if (Schema.is(Policy.PolicyDeniedError)(cause)) {
    // The only policy the shared write path applies to a machine key is the
    // merged-post guard: a merged post is readable, so this is a request the
    // resource's state cannot satisfy rather than a missing resource.
    return invalidRequestError(
      "This post has been merged into another post and cannot be changed."
    );
  }
  return internalError();
};

/**
 * The create endpoint's failures, which cannot include `NOT_FOUND`.
 *
 * A create cannot report a missing resource — the resource is what it makes —
 * so the endpoint publishes no 404 and the mapping drops the branch the shared
 * vocabulary allows. A `NOT_FOUND` there is unreachable by construction; if it
 * ever becomes reachable it is an internal failure, not a promise this API
 * should have made.
 */
const mapPostCreateFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((cause) => {
      const mapped = toPublicPostWriteError(cause);
      return Effect.fail(
        Schema.is(NotFoundError)(mapped) ? internalError() : mapped
      );
    })
  );

/**
 * The update and delete endpoints' failures, which cannot include `CONFLICT`.
 *
 * Neither re-derives a slug, so neither can collide with another post's. Their
 * endpoints publish no 409 for the same reason.
 */
const mapPostWriteFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((cause) => {
      const mapped = toPublicPostWriteError(cause);
      return Effect.fail(
        Schema.is(ConflictError)(mapped) ? internalError() : mapped
      );
    })
  );

/**
 * Why a merge or an unmerge was refused, on the published vocabulary.
 *
 * The repository reports the state in `reason` rather than only in prose, so a
 * missing post is a `NOT_FOUND` and an archived or already-merged one is a
 * `CONFLICT` without this mapping having to read the message.
 */
const toPublicMergeFailure = (
  cause: FailedToMergePostError
): NotFoundError | InvalidRequestError | ConflictError => {
  switch (cause.reason) {
    case "post_not_found":
      return notFoundError("Post not found.");
    case "same_post":
      return invalidRequestError("A post cannot be merged into itself.");
    case "post_not_merged":
      return conflictError("This post is not merged into another post.");
    case "source_merged":
      return conflictError(
        "This post has already been merged into another post."
      );
    case "target_merged":
      return conflictError(
        "The post to merge into has already been merged into another post."
      );
    case "source_archived":
      return conflictError(
        "This post is archived and cannot be merged into another post."
      );
    case "target_archived":
      return conflictError(
        "The post to merge into is archived and cannot absorb a duplicate."
      );
    case "source_has_children":
      return conflictError(
        "This post has absorbed another post and cannot be merged again."
      );
  }
};

/**
 * The merge and unmerge endpoints' failures.
 *
 * Neither writes a slug, so neither can collide on one, and every refusal the
 * shared path can produce is a state the public vocabulary already names.
 */
const mapPostMergeFailure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((cause) =>
      Effect.fail(
        Schema.is(FailedToMergePostError)(cause)
          ? toPublicMergeFailure(cause)
          : toPublicPostWriteError(cause)
      )
    )
  );

/**
 * Post storage as the Public API alone reads it.
 *
 * The writes are the dashboard's own shared write path (`post/write.ts`): the
 * sanitizer, the slug deduplication, the timeline, the integration events, the
 * outbox intents, and the search embedding. The Public API writes as
 * `api_key`, so the member-only side effects — on-behalf attribution, the
 * creator's subscription — are skipped rather than invented.
 *
 * The reads are public-specific: a private board is readable with a key,
 * archived and merged posts are handled per request, vote and comment counts
 * have no dashboard equivalent, and the author classification is computed in
 * SQL so no internal actor identifier is ever selected.
 */
const makePublicApiPostRepository = Effect.gen(function* () {
  const db = yield* currentDb;
  const s3 = yield* S3UploadService;
  // The shared post write path drives these from the fiber context rather than
  // from a value it holds, so the repository keeps a handle on each of them
  // and provides them below.
  const crypto = yield* Crypto.Crypto;
  const emailOutboxConfig = yield* EmailOutboxConfig;
  const emailSubscriptions = yield* EmailSubscriptionRepository;
  const integrationEventRecorder = yield* IntegrationEventRecorder;
  const postRepository = yield* PostRepository;
  const resolvePrincipal = yield* ResolvePrincipalService;
  const userRepository = yield* UserRepository;
  const writes = yield* makePostWrites;

  /**
   * Provides the services the shared post write path reads from the fiber
   * context.
   *
   * The HTTP layer answers a handler's service requirement with a `Request`
   * failure rather than satisfying it from the route layer, so a handler that
   * carried these would fail at request time while the layers were sitting
   * right beside it. The repository already holds each instance for its own
   * use, and closing over them here keeps every handler on the public surface
   * requirement-free.
   */
  const providePostWriteEnvironment = <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ) =>
    effect.pipe(
      Effect.provideService(Crypto.Crypto, crypto),
      Effect.provideService(Database.Database, db),
      Effect.provideService(EmailOutboxConfig, emailOutboxConfig),
      Effect.provideService(EmailSubscriptionRepository, emailSubscriptions),
      Effect.provideService(IntegrationEventRecorder, integrationEventRecorder),
      Effect.provideService(PostRepository, postRepository),
      Effect.provideService(ResolvePrincipalService, resolvePrincipal),
      Effect.provideService(S3UploadService, s3),
      Effect.provideService(UserRepository, userRepository)
    );

  const countByPostIds = (postIds: readonly string[]) =>
    Effect.gen(function* () {
      const voteRows = yield* db
        .select({
          postId: schema.upvoteTable.postId,
          total: count(schema.upvoteTable.id),
        })
        .from(schema.upvoteTable)
        .where(inArray(schema.upvoteTable.postId, postIds))
        .groupBy(schema.upvoteTable.postId);

      // Only public comments are counted: an internal comment is a workspace
      // note, and counting it would make this number disagree with the same
      // post's count on the public portal.
      const commentRows = yield* db
        .select({
          postId: schema.commentTable.postId,
          total: count(schema.commentTable.id),
        })
        .from(schema.commentTable)
        .where(
          and(
            inArray(schema.commentTable.postId, postIds),
            eq(schema.commentTable.visibility, "PUBLIC")
          )
        )
        .groupBy(schema.commentTable.postId);

      return {
        voteCount: new Map(voteRows.map((row) => [row.postId, row.total])),
        commentCount: new Map(
          commentRows.map((row) => [row.postId, row.total])
        ),
      };
    });

  const tagsByPostIds = (postIds: readonly string[]) =>
    db
      .select({
        postId: schema.postTagTable.postId,
        id: schema.tagTable.id,
        name: schema.tagTable.name,
      })
      .from(schema.postTagTable)
      .innerJoin(
        schema.tagTable,
        eq(schema.tagTable.id, schema.postTagTable.tagId)
      )
      .where(inArray(schema.postTagTable.postId, postIds))
      // Ordered so a post's tag array is stable across requests. The contract
      // does not promise an order, but a caller diffing two responses of the
      // same post should not see it shuffle.
      .orderBy(asc(schema.tagTable.name));

  /**
   * The filters every post list applies, in one place.
   *
   * A merged post is superseded by its survivor, so it is never listed — the
   * same rule as the portal, and it keeps `mergedIntoPostId` meaningful rather
   * than listing duplicates. Archived posts are excluded unless asked for, and
   * the cursor walks the `(createdAt, id)` tuple the page is ordered by.
   *
   * The optional filters are the ones an integration syncs with: a board, a set
   * of tags, and a change time. `tagIds` is an `exists` rather than a join, so a
   * post carrying two of the requested tags is one row rather than two, which
   * is what keeps the page size and the cursor honest.
   */
  const postPageConditions = ({
    boardId,
    cursor,
    includeArchived,
    organizationId,
    statusId,
    tagIds,
    updatedAfter,
  }: {
    readonly boardId: string | null;
    readonly cursor: Cursor | null;
    readonly includeArchived: boolean;
    readonly organizationId: string;
    readonly statusId: string | null;
    readonly tagIds: readonly string[] | null;
    readonly updatedAfter: Date | null;
  }): SQL[] => {
    const conditions: SQL[] = [
      eq(schema.postTable.organizationId, organizationId),
      isNull(schema.postTable.mergedIntoPostId),
    ];
    if (!includeArchived) {
      conditions.push(isNull(schema.postTable.archivedAt));
    }
    if (boardId !== null) {
      conditions.push(eq(schema.postTable.boardId, boardId));
    }
    if (statusId !== null) {
      conditions.push(eq(schema.postTable.statusId, statusId));
    }
    if (tagIds !== null && tagIds.length > 0) {
      conditions.push(
        exists(
          db
            .select({ id: schema.postTagTable.id })
            .from(schema.postTagTable)
            .where(
              and(
                eq(schema.postTagTable.postId, schema.postTable.id),
                inArray(schema.postTagTable.tagId, tagIds)
              )
            )
        )
      );
    }
    // `>` rather than `>=`: a caller polls with the timestamp of the last row
    // it saw, and a row it has already read must not come back and be applied
    // twice.
    if (updatedAfter !== null) {
      conditions.push(gt(schema.postTable.updatedAt, updatedAfter));
    }
    if (cursor !== null) {
      conditions.push(
        sql`(${schema.postTable.createdAt}, ${schema.postTable.id}) < (${cursor.createdAt}, ${cursor.id})`
      );
    }
    return conditions;
  };

  /**
   * A page of posts matching `conditions`, newest first.
   *
   * The page query both list endpoints share: filters come in as conditions so
   * a board-scoped list and a workspace-wide one cannot diverge on ordering,
   * the cursor tuple, or how counts and tags are attached.
   *
   * Fetches `limit + 1` rows so the caller learns whether another page exists
   * without a second query, and pages on `(createdAt, id)` — the same tuple
   * the cursor carries — so concurrently inserted posts cannot make a caller
   * skip or repeat a row the way an offset would.
   */
  const pagePosts = ({
    conditions,
    limit,
  }: {
    readonly conditions: readonly SQL[];
    readonly limit: number;
  }) =>
    Effect.gen(function* () {
      const rows = yield* db
        .select(POST_COLUMNS)
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .innerJoin(
          schema.postStatusTable,
          eq(schema.postStatusTable.id, schema.postTable.statusId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .leftJoin(
          schema.contactTable,
          eq(schema.contactTable.id, schema.postTable.contactId)
        )
        .where(and(...conditions))
        .orderBy(desc(schema.postTable.createdAt), desc(schema.postTable.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      if (pageRows.length === 0) {
        return { posts: [], nextCursor: null } satisfies PublicApiPostPage;
      }

      const postIds = pageRows.map((row) => row.id);
      const counts = yield* countByPostIds(postIds);
      const tagRows = yield* tagsByPostIds(postIds);

      const tagsByPost = new Map<string, { id: string; name: string }[]>();
      for (const tag of tagRows) {
        const existing = tagsByPost.get(tag.postId) ?? [];
        existing.push({ id: tag.id, name: tag.name });
        tagsByPost.set(tag.postId, existing);
      }

      const lastRow = pageRows[pageRows.length - 1];

      return {
        posts: pageRows.map((row) => ({
          ...toSource(
            row,
            {
              voteCount: counts.voteCount.get(row.id) ?? 0,
              commentCount: counts.commentCount.get(row.id) ?? 0,
            },
            tagsByPost.get(row.id) ?? []
          ),
          boardSlug: row.boardSlug,
        })),
        nextCursor:
          hasMore && lastRow !== undefined
            ? { createdAt: lastRow.createdAt, id: lastRow.id }
            : null,
      } satisfies PublicApiPostPage;
    });

  /**
   * A single post, including its stored (already sanitized) body.
   *
   * A local function rather than only a repository method: the write path
   * reads back what it wrote through the same projection, so a create or an
   * update cannot answer with a differently shaped post than a later `GET`.
   *
   * At least one identifier is required — `postId`, or the `boardId` and
   * `slug` pair — and the caller is what rejects a request that names none.
   * Every identifier that is present narrows the lookup, so a caller that
   * supplies an id and a board is answered as not found when the post is on a
   * different board rather than being silently redirected.
   */
  const readPost = ({
    boardId,
    organizationId,
    postId,
    slug,
  }: {
    boardId?: string | undefined;
    organizationId: string;
    postId?: string | undefined;
    slug?: string | undefined;
  }) =>
    Effect.gen(function* () {
      const conditions: SQL[] = [
        eq(schema.postTable.organizationId, organizationId),
      ];
      if (postId !== undefined) {
        conditions.push(eq(schema.postTable.id, postId));
      }
      if (boardId !== undefined) {
        conditions.push(eq(schema.postTable.boardId, boardId));
      }
      if (slug !== undefined) {
        conditions.push(eq(schema.postTable.slug, slug));
      }

      const rows = yield* db
        .select({ ...POST_COLUMNS, content: schema.postTable.content })
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .innerJoin(
          schema.postStatusTable,
          eq(schema.postStatusTable.id, schema.postTable.statusId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .leftJoin(
          schema.contactTable,
          eq(schema.contactTable.id, schema.postTable.contactId)
        )
        .where(and(...conditions))
        .limit(1);

      const row = rows.at(0);
      if (row === undefined) {
        return Option.none();
      }

      const counts = yield* countByPostIds([row.id]);
      const tagRows = yield* tagsByPostIds([row.id]);

      return Option.some({
        ...toSource(
          row,
          {
            voteCount: counts.voteCount.get(row.id) ?? 0,
            commentCount: counts.commentCount.get(row.id) ?? 0,
          },
          tagRows.map((tag) => ({ id: tag.id, name: tag.name }))
        ),
        boardSlug: row.boardSlug,
        content: row.content,
      });
    });

  return {
    /**
     * One page of a board's posts, newest first.
     *
     * Distinguishes an empty board from one that does not exist in this
     * workspace before running the page query: otherwise both come back as a
     * successful empty page, and the caller cannot tell them apart. A board of
     * another workspace is reported the same way as a missing one, so the id
     * cannot be used to probe other workspaces.
     */
    listBoardPosts: ({
      boardId,
      cursor,
      includeArchived,
      limit,
      organizationId,
      statusId,
      tagIds,
      updatedAfter,
    }: {
      boardId: string;
      cursor: Cursor | null;
      includeArchived: boolean;
      limit: number;
      organizationId: string;
      statusId: string | null;
      tagIds: readonly string[] | null;
      updatedAfter: Date | null;
    }) =>
      Effect.gen(function* () {
        const board = yield* db
          .select({ id: schema.boardTable.id })
          .from(schema.boardTable)
          .where(
            and(
              eq(schema.boardTable.id, boardId),
              eq(schema.boardTable.organizationId, organizationId)
            )
          )
          .limit(1);

        if (board.length === 0) {
          return Option.none();
        }

        return Option.some(
          yield* pagePosts({
            conditions: postPageConditions({
              boardId,
              cursor,
              includeArchived,
              organizationId,
              statusId,
              tagIds,
              updatedAfter,
            }),
            limit,
          })
        );
      }).pipe(withRemapDbErrors("PublicApiPost", "select")),

    /**
     * One page of the workspace's posts, newest first.
     *
     * The board-scoped list with the board filter left out: every board is
     * included, private ones too, because the key is the workspace's own
     * credential. Archived and merged posts are handled exactly as they are
     * there, and the page uses the same cursor tuple, so a caller that has
     * learned one paging rule has learned both.
     */
    listPosts: ({
      boardId,
      cursor,
      includeArchived,
      limit,
      organizationId,
      statusId,
      tagIds,
      updatedAfter,
    }: {
      boardId: string | null;
      cursor: Cursor | null;
      includeArchived: boolean;
      limit: number;
      organizationId: string;
      statusId: string | null;
      tagIds: readonly string[] | null;
      updatedAfter: Date | null;
    }) =>
      pagePosts({
        conditions: postPageConditions({
          boardId,
          cursor,
          includeArchived,
          organizationId,
          statusId,
          tagIds,
          updatedAfter,
        }),
        limit,
      }).pipe(withRemapDbErrors("PublicApiPost", "select")),

    /** A single post, including its stored (already sanitized) body. */
    findPost: (args: {
      boardId?: string | undefined;
      organizationId: string;
      postId?: string | undefined;
      slug?: string | undefined;
    }) => readPost(args).pipe(withRemapDbErrors("PublicApiPost", "select")),

    /**
     * Creates a post and returns it as a later read would.
     *
     * The id is minted here rather than accepted from the caller: a machine key
     * is not a member acting on records it can already see, and a caller-chosen
     * id would make the primary key part of the request surface. `source` is
     * written as `API` so a workspace can tell an integration's posts from its
     * own.
     *
     * The whole write — the insert, the slug deduplication, the timeline
     * entry, the integration event, the submission email intent, and the
     * search embedding — is the dashboard's own path with an `api_key` actor,
     * so an API-created post is not a second-class kind of post.
     */
    createPost: ({
      author,
      boardId,
      content,
      createdAt,
      etaQuarter,
      organizationId,
      statusId,
      title,
    }: {
      author?: TPublicApiOnBehalfAuthor | undefined;
      boardId: string;
      content: string;
      createdAt?: Date | undefined;
      etaQuarter: string | null;
      organizationId: string;
      statusId: string;
      title: string;
    }) =>
      Effect.gen(function* () {
        const postId = yield* PostId.generate;
        // The API names no assets: editor-asset references come from the ids
        // a dashboard editor submits with its content, and a machine key has
        // none. A body may still embed a workspace media URL, but the post is
        // not recorded as referencing it — see `docs/public-api.md`, and the
        // orphan sweep's rule in `asset/service.ts`.
        yield* writes.create(
          {
            assetIds: [],
            ...(author !== undefined && { author }),
            boardId,
            content,
            ...(createdAt !== undefined && { createdAt }),
            etaQuarter,
            id: postId,
            organizationId,
            source: "API",
            statusId,
            title,
          },
          { kind: "api_key" }
        );

        const created = yield* readPost({ organizationId, postId });
        // An insert that committed is readable a moment later; an empty read
        // means the row was removed between the two statements, which is a
        // race this API can only report as its own failure.
        return yield* Effect.fromOption(created, () =>
          internalError("The post could not be read after it was created.")
        );
      }).pipe(providePostWriteEnvironment, mapPostCreateFailure),

    /**
     * Updates the fields the request names and returns the post afterwards.
     *
     * A partial update: an absent field is left alone and an explicit `null`
     * clears a nullable one. The shared write path decides what actually
     * changed inside one transaction, so a patch naming several fields is
     * atomic and produces the same timeline and integration events the
     * dashboard's single-field RPCs do.
     */
    updatePost: ({
      author,
      boardId,
      content,
      etaQuarter,
      organizationId,
      postId,
      statusId,
      title,
    }: {
      author?: TPublicApiOnBehalfAuthor | undefined;
      boardId: string | undefined;
      content: string | undefined;
      etaQuarter: string | null | undefined;
      organizationId: string;
      postId: string;
      statusId: string | undefined;
      title: string | undefined;
    }) =>
      Effect.gen(function* () {
        // No `assetIds` are named, for the same reason a create names none.
        // An update that keeps a dashboard-attached image in the body keeps
        // its reference (the shared path retains the post's current ones), and
        // one that drops the URL drops the reference; a URL the API introduces
        // is not registered — see `docs/public-api.md`.
        yield* writes.update(
          {
            ...(author !== undefined && { author }),
            boardId,
            content,
            etaQuarter,
            id: postId,
            organizationId,
            statusId,
            title,
          },
          { kind: "api_key" }
        );

        // A read that comes back empty means the post was deleted while this
        // request was in flight; the caller answers the documented `NOT_FOUND`
        // rather than a success that changed nothing.
        return yield* readPost({ organizationId, postId });
      }).pipe(providePostWriteEnvironment, mapPostWriteFailure),

    /**
     * Deletes a post, answering as the missing resource when there is none.
     *
     * The post is read first for two reasons: the dashboard's delete is
     * board-scoped while the endpoint names only the post, and a merged post
     * has to be answered as such — it is still readable through
     * `GET /posts/{postId}`, so `404` would be a lie.
     *
     * A key holding `posts.delete` deletes without the dashboard's
     * creator-and-engagement scope: it is the workspace's own credential, not
     * a member acting on their own posts.
     */
    deletePost: ({
      organizationId,
      postId,
    }: {
      organizationId: string;
      postId: string;
    }) =>
      Effect.gen(function* () {
        // The board that scopes the delete, and whether the post is merged,
        // are read here and then re-checked by the delete's own transaction,
        // which cannot see this read. A post that moved boards in between
        // makes the delete match nothing, and one merged in between is
        // refused by the transaction: either would otherwise be reported as
        // missing. One retry re-reads and answers with what the post is now —
        // deleted on its new board, or the documented merged refusal. A
        // second race in a row is answered as not found, which is where the
        // read leaves it.
        const resolveAndRemove = Effect.gen(function* () {
          const post = yield* Effect.fromOption(
            yield* readPost({ organizationId, postId }),
            () => notFoundError("Post not found.")
          );

          if (post.mergedIntoPostId !== null) {
            return yield* invalidRequestError(
              "This post has been merged into another post and cannot be deleted."
            );
          }

          yield* writes.remove(
            {
              boardId: post.boardId,
              id: postId,
              mayDeleteEngaged: true,
              organizationId,
            },
            { kind: "api_key" }
          );

          return undefined;
        });

        yield* resolveAndRemove.pipe(
          Effect.retry({
            times: 1,
            while: (error) => Schema.is(PostNotFoundError)(error),
          }),
          Effect.catch((cause) => {
            const mapped = toPublicPostWriteError(cause);
            return Effect.fail(
              Schema.is(ConflictError)(mapped) ? internalError() : mapped
            );
          }),
          providePostWriteEnvironment
        );
      }),

    /**
     * Folds one post into another, and reverts that.
     *
     * The move, the two timeline entries, the notification fan-out, and the
     * email intent are the dashboard's own shared write path
     * (`post/write.ts`) with an `api_key` actor: a key has no member identity,
     * so the timeline entries it writes have no actor and the merge email is
     * the only one sent. Nothing about the merge is reimplemented here, which
     * is what keeps an API merge and a dashboard merge from diverging.
     */
    mergePost: ({
      intoPostId,
      organizationId,
      postId,
    }: {
      intoPostId: string;
      organizationId: string;
      postId: string;
    }) =>
      writes
        .merge(
          { organizationId, sourcePostId: postId, targetPostId: intoPostId },
          { kind: "api_key" }
        )
        .pipe(
          providePostWriteEnvironment,
          withRemapDbErrors("PublicApiPost", "update"),
          mapPostMergeFailure
        ),

    /**
     * Restores a merged post to its board, the inverse of `mergePost`.
     *
     * The post named by the path is the archived source, so a caller that
     * merged `A` into `B` unmerges by naming `A` and never has to remember
     * `B` — the source row is what records where it went.
     */
    unmergePost: ({
      organizationId,
      postId,
    }: {
      organizationId: string;
      postId: string;
    }) =>
      writes
        .unmerge({ organizationId, sourcePostId: postId }, { kind: "api_key" })
        .pipe(
          providePostWriteEnvironment,
          withRemapDbErrors("PublicApiPost", "update"),
          mapPostMergeFailure
        ),
  };
});

export class PublicApiPostRepository extends Context.Service<PublicApiPostRepository>()(
  "PublicApiPostRepository",
  {
    make: makePublicApiPostRepository,
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
export const currentPublicApiPostRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, PublicApiPostRepository))
);
