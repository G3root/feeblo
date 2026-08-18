import { currentDb, schema } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  notExists,
  type SQL,
  sql,
} from "drizzle-orm";
import * as EffectArray from "effect/Array";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { WorkflowEngine } from "effect/unstable/workflow/WorkflowEngine";

import { getUniqueViolationConstraint, isUniqueViolation } from "../rpc-errors";
import { FailedToMergePostError, PostAlreadyExistsError } from "./errors";
import type { TPostAdminUpdate } from "./schema";
import { scheduleSubmissionNotificationBatch } from "./workflow";

interface TPostUpdateInput {
  boardId?: string;
  content?: string;
  etaQuarter?: string | null | undefined;
  excerpt?: string;
  id: string;
  organizationId: string;
  statusId?: string;
  title?: string;
}

interface TPostFindMany {
  boardId?: string | null | undefined;
  organizationId: string;
  userId?: string | null | undefined;
}

interface TPostDelete {
  boardId: string;
  creatorId: string;
  id: string | readonly string[];
  onlyIfNew: boolean;
  organizationId: string;
}

interface TPostCreate {
  boardId: string;
  contactId?: string | null;
  content: string;
  creatorId?: string | null;
  creatorMemberId?: string | null;
  etaQuarter?: string | null | undefined;
  excerpt?: string;
  id: string;
  metadata?: Record<string, string>;
  organizationId: string;
  source?:
    | "DASHBOARD"
    | "WIDGET"
    | "API"
    | "IMPORT"
    | "PUBLIC_BOARD"
    | "SLACK"
    | "DISCORD";
  statusId: string;
  title: string;
}

interface TPostMerge {
  organizationId: string;
  sourcePostId: string;
  targetPostId: string;
}

interface TPostFindByCreatorId {
  boardId: string;
  id: string;
  organizationId: string;
  userId: string;
}

interface TPostFindByCreatorIds {
  boardId: string;
  ids: readonly string[];
  organizationId: string;
  userId: string;
}

interface TPostFindNewByCreatorId extends TPostFindByCreatorId {}

interface TPostFindNewByCreatorIds extends TPostFindByCreatorIds {}

interface TPostById {
  id: string;
  organizationId: string;
}

interface TPostSuggestionCandidates {
  boardId?: string;
  embedding?: readonly number[];
  embeddingModel?: string;
  limit: number;
  organizationId: string;
  publicOnly: boolean;
}

const getWhereClause = (where: SQL[]) =>
  where.length > 1
    ? and(...where)
    : Option.match(EffectArray.get(0)(where), {
        onNone: () => undefined,
        onSome: (clause) => clause,
      });

const selectPostFields = (userId?: string | null) => ({
  id: schema.postTable.id,
  title: schema.postTable.title,
  boardId: schema.postTable.boardId,
  slug: schema.postTable.slug,
  content: schema.postTable.content,
  excerpt: schema.postTable.excerpt,
  statusId: schema.postTable.statusId,
  etaQuarter: schema.postTable.etaQuarter,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  organizationId: schema.postTable.organizationId,
  user: {
    name: sql<string | null>`${schema.userTable.name}`,
    image: sql<string | null>`${schema.userTable.image}`,
  },
  creatorMemberId: schema.postTable.creatorMemberId,
  creatorId: schema.postTable.creatorId,
  canDeleteAsCreator: userId
    ? sql<boolean>`(
        ${schema.postTable.creatorId} = ${userId}
        AND NOT EXISTS (
          SELECT 1
          FROM ${schema.commentTable}
          WHERE ${schema.commentTable.postId} = ${schema.postTable.id}
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ${schema.upvoteTable}
          WHERE ${schema.upvoteTable.postId} = ${schema.postTable.id}
            AND ${schema.upvoteTable.userId} <> ${userId}
        )
      )`
    : sql<boolean>`false`,
  metadata: schema.postTable.metadata,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  mergedAt: schema.postTable.mergedAt,
});

const makePostRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  return {
    findActivityState: ({ id, organizationId }: TPostById) =>
      db
        .select({
          archivedAt: schema.postTable.archivedAt,
          boardId: schema.postTable.boardId,
          content: schema.postTable.content,
          etaQuarter: schema.postTable.etaQuarter,
          lockedAt: schema.postTable.lockedAt,
          statusId: schema.postTable.statusId,
          title: schema.postTable.title,
        })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .for("update")
        .pipe(Effect.map((rows) => rows[0])),

    findStatusId: ({ id, organizationId }: TPostById) =>
      db
        .select({ statusId: schema.postTable.statusId })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]?.statusId)),

    findStatusType: ({
      id,
      organizationId,
    }: {
      readonly id: string;
      readonly organizationId: string;
    }) =>
      db
        .select({ type: schema.postStatusTable.type })
        .from(schema.postStatusTable)
        .where(
          and(
            eq(schema.postStatusTable.id, id),
            eq(schema.postStatusTable.organizationId, organizationId)
          )
        )
        .limit(1)
        .pipe(Effect.map((rows) => rows[0]?.type)),

    findByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorId) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId)
          )
        )
        .pipe(Effect.map(EffectArray.get(0))),

    findByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorIds) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            inArray(schema.postTable.id, ids),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId)
          )
        ),

    findNewByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindNewByCreatorId) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId),
            notExists(
              db
                .select({ id: schema.commentTable.id })
                .from(schema.commentTable)
                .where(eq(schema.commentTable.postId, schema.postTable.id))
            ),
            notExists(
              db
                .select({ id: schema.upvoteTable.id })
                .from(schema.upvoteTable)
                .where(
                  and(
                    eq(schema.upvoteTable.postId, schema.postTable.id),
                    ne(schema.upvoteTable.userId, userId)
                  )
                )
            )
          )
        )
        .pipe(Effect.map(EffectArray.get(0))),

    findNewByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindNewByCreatorIds) =>
      db
        .select({ id: schema.postTable.id })
        .from(schema.postTable)
        .where(
          and(
            inArray(schema.postTable.id, ids),
            eq(schema.postTable.organizationId, organizationId),
            eq(schema.postTable.creatorId, userId),
            eq(schema.postTable.boardId, boardId),
            notExists(
              db
                .select({ id: schema.commentTable.id })
                .from(schema.commentTable)
                .where(eq(schema.commentTable.postId, schema.postTable.id))
            ),
            notExists(
              db
                .select({ id: schema.upvoteTable.id })
                .from(schema.upvoteTable)
                .where(
                  and(
                    eq(schema.upvoteTable.postId, schema.postTable.id),
                    ne(schema.upvoteTable.userId, userId)
                  )
                )
            )
          )
        ),

    findMany: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }

      where.push(eq(schema.postTable.organizationId, organizationId));
      const whereClause = getWhereClause(where);

      return db
        .select(selectPostFields(userId))
        .from(schema.postTable)
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(whereClause);
    },

    findManyPublic: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [
        eq(schema.postTable.organizationId, organizationId),
      ];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }
      where.push(eq(schema.boardTable.visibility, "PUBLIC"));

      const whereClause = and(...where);

      return db
        .select(selectPostFields(userId))
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(whereClause);
    },

    findSuggestionCandidates: ({
      boardId,
      embedding,
      embeddingModel,
      limit,
      organizationId,
      publicOnly,
    }: TPostSuggestionCandidates) => {
      const where: SQL[] = [
        eq(schema.postTable.organizationId, organizationId),
        sql`${schema.postTable.archivedAt} is null`,
        sql`${schema.postTable.mergedIntoPostId} is null`,
      ];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }
      if (publicOnly) {
        where.push(eq(schema.boardTable.visibility, "PUBLIC"));
      }
      if (embedding) {
        where.push(isNotNull(schema.postTable.embedding));
        if (embeddingModel) {
          where.push(eq(schema.postTable.embeddingModel, embeddingModel));
        }
      }

      const query = db
        .select({
          ...selectPostFields(),
          distance: embedding
            ? sql<
                number | null
              >`${cosineDistance(schema.postTable.embedding, [...embedding])}`
            : sql<number | null>`null`,
        })
        .from(schema.postTable)
        .innerJoin(
          schema.boardTable,
          eq(schema.boardTable.id, schema.postTable.boardId)
        )
        .leftJoin(
          schema.userTable,
          eq(schema.userTable.id, schema.postTable.creatorId)
        )
        .where(and(...where));

      return embedding
        ? query
            .orderBy(
              asc(cosineDistance(schema.postTable.embedding, [...embedding]))
            )
            .limit(limit)
        : query.orderBy(desc(schema.postTable.updatedAt)).limit(limit);
    },

    isPublicPost: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.boardTable.visibility, "PUBLIC")
            )
          );
        return rows.length > 0;
      }),

    isUnlocked: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              sql`${schema.postTable.lockedAt} is null`
            )
          );
        return rows.length > 0;
      }),

    isUnlockedPublic: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .innerJoin(
            schema.boardTable,
            eq(schema.boardTable.id, schema.postTable.boardId)
          )
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.boardTable.visibility, "PUBLIC"),
              sql`${schema.postTable.lockedAt} is null`
            )
          );
        return rows.length > 0;
      }),

    update: ({
      id,
      organizationId,
      statusId,
      boardId,
      title,
      content,
      excerpt,
      etaQuarter,
    }: TPostUpdateInput) =>
      db
        .update(schema.postTable)
        .set({
          statusId,
          boardId,
          title,
          content,
          excerpt:
            content !== undefined
              ? (excerpt ?? htmlToExcerpt(content))
              : excerpt,
          etaQuarter,
        })
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    updateEta: ({
      id,
      organizationId,
      etaQuarter,
    }: {
      id: string;
      organizationId: string;
      etaQuarter: string | null;
    }) =>
      db
        .update(schema.postTable)
        .set({ etaQuarter })
        .where(
          and(
            eq(schema.postTable.id, id),
            eq(schema.postTable.organizationId, organizationId)
          )
        )
        .pipe(Effect.asVoid),

    updateEmbedding: ({
      embedding,
      expectedContent,
      expectedTitle,
      id,
      model,
      organizationId,
    }: {
      embedding: readonly number[];
      expectedContent: string;
      expectedTitle: string;
      id: string;
      model: string;
      organizationId: string;
    }) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.postTable)
          .set({
            embeddedAt: now,
            embedding: [...embedding],
            embeddingModel: model,
          })
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.title, expectedTitle),
              eq(schema.postTable.content, expectedContent)
            )
          )
          .pipe(Effect.asVoid);
      }),

    adminUpdate: ({ id, organizationId, archived, locked }: TPostAdminUpdate) =>
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .update(schema.postTable)
          .set({
            archivedAt:
              archived === undefined ? undefined : archived ? now : null,
            lockedAt: locked === undefined ? undefined : locked ? now : null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId)
            )
          )
          .pipe(Effect.asVoid);
      }),

    delete: ({
      id,
      organizationId,
      boardId,
      creatorId,
      onlyIfNew,
    }: TPostDelete) => {
      const ids = typeof id === "string" ? [id] : id;
      const postScope = and(
        inArray(schema.postTable.id, ids),
        eq(schema.postTable.organizationId, organizationId),
        eq(schema.postTable.boardId, boardId)
      );

      return Effect.gen(function* () {
        // Lock the posts before checking engagement. Comment/upvote inserts
        // reference these rows, so concurrent activity waits for this check.
        const posts = yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(postScope)
          .for("update");

        if (onlyIfNew) {
          const newPosts = yield* db
            .select({ id: schema.postTable.id })
            .from(schema.postTable)
            .where(
              and(
                postScope,
                eq(schema.postTable.creatorId, creatorId),
                notExists(
                  db
                    .select({ id: schema.commentTable.id })
                    .from(schema.commentTable)
                    .where(eq(schema.commentTable.postId, schema.postTable.id))
                ),
                notExists(
                  db
                    .select({ id: schema.upvoteTable.id })
                    .from(schema.upvoteTable)
                    .where(
                      and(
                        eq(schema.upvoteTable.postId, schema.postTable.id),
                        ne(schema.upvoteTable.userId, creatorId)
                      )
                    )
                )
              )
            );

          if (newPosts.length !== posts.length) {
            return false;
          }
        }

        const deleted = yield* db
          .delete(schema.postTable)
          .where(postScope)
          .returning({ id: schema.postTable.id });

        return deleted.length === posts.length;
      });
    },

    create: ({
      id,
      boardId,
      organizationId,
      title,
      content,
      statusId,
      creatorId,
      creatorMemberId,
      contactId,
      metadata,
      source,
      excerpt: inputExcerpt,
      etaQuarter,
    }: TPostCreate) =>
      Effect.gen(function* () {
        const excerpt = inputExcerpt ?? htmlToExcerpt(content);
        const baseSlug = slugify(title);

        // Slugs are unique per organization (see post_organizationId_slug_uidx),
        // so a title that already exists anywhere in the organization must be
        // deduplicated instead of rejected. Each insert attempt runs in its own
        // savepoint (nested db.transaction), so a unique-violation failure rolls
        // back without aborting the enclosing transaction and the next suffix
        // can be tried. The native Effect retry policy re-executes the insert
        // with the next candidate slug until one succeeds; when the suffix
        // space is exhausted a typed PostAlreadyExistsError is returned.
        const MAX_SLUG_ATTEMPTS = 10;
        const slugCollision = { _tag: "SlugCollision" } as const;

        // The candidate slug depends on the attempt index, so the insert
        // effect is rebuilt lazily per attempt via Effect.suspend. Effect.retry
        // re-executes it, incrementing the counter on each retry.
        let attemptIndex = 0;
        const tryCreate = Effect.suspend(() =>
          Effect.gen(function* () {
            const slug =
              attemptIndex === 0 ? baseSlug : `${baseSlug}-${attemptIndex + 1}`;
            attemptIndex += 1;
            const now = yield* DateTime.nowAsDate;

            return yield* db
              .transaction(() =>
                db
                  .insert(schema.postTable)
                  .values({
                    id,
                    boardId,
                    organizationId,
                    title,
                    content,
                    excerpt,
                    statusId,
                    creatorId: creatorId ?? null,
                    creatorMemberId: creatorMemberId ?? null,
                    contactId: contactId ?? null,
                    source: source ?? "DASHBOARD",
                    metadata: metadata ?? {},
                    createdAt: now,
                    slug,
                    updatedAt: now,
                    etaQuarter: etaQuarter ?? null,
                  })
                  .pipe(Effect.as(slug))
              )
              .pipe(
                Effect.catchIf(
                  (error) =>
                    isUniqueViolation(error) &&
                    getUniqueViolationConstraint(error) ===
                      "post_organizationId_slug_uidx",
                  () => Effect.fail(slugCollision)
                )
              );
          })
        );

        return yield* Effect.retry(tryCreate, {
          // Initial attempt plus MAX_SLUG_ATTEMPTS - 1 retries.
          times: MAX_SLUG_ATTEMPTS - 1,
          while: (error) => error._tag === "SlugCollision",
        }).pipe(
          Effect.catchTag(
            "SlugCollision",
            () =>
              new PostAlreadyExistsError({
                message: "A post with this slug already exists",
              })
          )
        );
      }),

    merge: ({ organizationId, sourcePostId, targetPostId }: TPostMerge) =>
      db.transaction((tx) =>
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const posts = yield* tx
            .select({
              id: schema.postTable.id,
              archivedAt: schema.postTable.archivedAt,
              mergedIntoPostId: schema.postTable.mergedIntoPostId,
            })
            .from(schema.postTable)
            .where(
              and(
                inArray(schema.postTable.id, [sourcePostId, targetPostId]),
                eq(schema.postTable.organizationId, organizationId)
              )
            );

          const sourcePost = posts.find((post) => post.id === sourcePostId);
          const targetPost = posts.find((post) => post.id === targetPostId);

          if (!(sourcePost && targetPost)) {
            return yield* new FailedToMergePostError({
              message: "Source or target post not found",
            });
          }
          if (sourcePostId === targetPostId) {
            return yield* new FailedToMergePostError({
              message: "Source and target posts must be different",
            });
          }
          if (sourcePost.mergedIntoPostId) {
            return yield* new FailedToMergePostError({
              message: "Source post is already merged into another post",
            });
          }
          if (sourcePost.archivedAt) {
            return yield* new FailedToMergePostError({
              message: "Source post is archived and cannot be merged",
            });
          }
          if (targetPost.mergedIntoPostId) {
            return yield* new FailedToMergePostError({
              message: "Target post is already merged into another post",
            });
          }
          if (targetPost.archivedAt) {
            return yield* new FailedToMergePostError({
              message: "Target post is archived and cannot be a merge target",
            });
          }

          yield* tx
            .update(schema.commentTable)
            .set({ postId: targetPostId })
            .where(eq(schema.commentTable.postId, sourcePostId));

          const upvotes = yield* tx
            .select({
              id: schema.upvoteTable.id,
              userId: schema.upvoteTable.userId,
            })
            .from(schema.upvoteTable)
            .where(eq(schema.upvoteTable.postId, sourcePostId));

          for (const upvote of upvotes) {
            const existing = yield* tx
              .select({ id: schema.upvoteTable.id })
              .from(schema.upvoteTable)
              .where(
                and(
                  eq(schema.upvoteTable.postId, targetPostId),
                  eq(schema.upvoteTable.userId, upvote.userId)
                )
              )
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existing)) {
              yield* tx
                .delete(schema.upvoteTable)
                .where(eq(schema.upvoteTable.id, upvote.id));
              continue;
            }

            yield* tx
              .update(schema.upvoteTable)
              .set({ postId: targetPostId })
              .where(eq(schema.upvoteTable.id, upvote.id));
          }

          const reactions = yield* tx
            .select({
              emoji: schema.postReactionTable.emoji,
              id: schema.postReactionTable.id,
              userId: schema.postReactionTable.userId,
            })
            .from(schema.postReactionTable)
            .where(eq(schema.postReactionTable.postId, sourcePostId));

          for (const reaction of reactions) {
            const existing = yield* tx
              .select({ id: schema.postReactionTable.id })
              .from(schema.postReactionTable)
              .where(
                and(
                  eq(schema.postReactionTable.postId, targetPostId),
                  eq(schema.postReactionTable.userId, reaction.userId),
                  eq(schema.postReactionTable.emoji, reaction.emoji)
                )
              )
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existing)) {
              yield* tx
                .delete(schema.postReactionTable)
                .where(eq(schema.postReactionTable.id, reaction.id));
              continue;
            }

            yield* tx
              .update(schema.postReactionTable)
              .set({ postId: targetPostId })
              .where(eq(schema.postReactionTable.id, reaction.id));
          }

          const postTags = yield* tx
            .select({
              id: schema.postTagTable.id,
              tagId: schema.postTagTable.tagId,
            })
            .from(schema.postTagTable)
            .where(eq(schema.postTagTable.postId, sourcePostId));

          for (const postTag of postTags) {
            const existing = yield* tx
              .select({ id: schema.postTagTable.id })
              .from(schema.postTagTable)
              .where(
                and(
                  eq(schema.postTagTable.postId, targetPostId),
                  eq(schema.postTagTable.tagId, postTag.tagId)
                )
              )
              .limit(1)
              .pipe(Effect.map(EffectArray.get(0)));

            if (Option.isSome(existing)) {
              yield* tx
                .delete(schema.postTagTable)
                .where(eq(schema.postTagTable.id, postTag.id));
              continue;
            }

            yield* tx
              .update(schema.postTagTable)
              .set({ postId: targetPostId })
              .where(eq(schema.postTagTable.id, postTag.id));
          }

          yield* tx
            .update(schema.postTable)
            .set({
              archivedAt: now,
              mergedAt: now,
              mergedIntoPostId: targetPostId,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.postTable.id, sourcePostId),
                eq(schema.postTable.organizationId, organizationId)
              )
            );
        })
      ),

    enqueueSubmissionNotification: ({
      postId,
      organizationId,
    }: {
      postId: string;
      organizationId: string;
    }) =>
      db
        .insert(schema.submissionNotificationQueueTable)
        .values({ postId, organizationId })
        .pipe(Effect.asVoid),

    scheduleSubmissionNotification: (organizationId: string) =>
      Effect.gen(function* () {
        const engineOption = yield* Effect.serviceOption(WorkflowEngine);

        if (Option.isNone(engineOption)) {
          return;
        }

        yield* scheduleSubmissionNotificationBatch(organizationId).pipe(
          Effect.provideService(WorkflowEngine, engineOption.value)
        );
      }),
  };
});

export class PostRepository extends Context.Service<PostRepository>()(
  "PostRepository",
  {
    make: makePostRepository,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
