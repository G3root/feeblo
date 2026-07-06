/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { currentDb, schema, transaction } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer, Option } from "effect";
import { FailedToMergePostError } from "./errors";
import type { TPostAdminUpdate, TPostUpdate } from "./schema";

interface TPostFindMany {
  boardId?: string | null | undefined;
  organizationId: string;
  userId?: string | null | undefined;
}

interface TPostDelete {
  boardId: string;
  id: string | readonly string[];
  organizationId: string;
}

interface TPostCreate {
  boardId: string;
  content: string;
  creatorId: string;
  creatorMemberId?: string;
  excerpt?: string;
  id: string;
  organizationId: string;
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

interface TPostById {
  id: string;
  organizationId: string;
}

const getWhereClause = (where: SQL[]) =>
  where.length > 1
    ? and(...where)
    : Option.match(EffectArray.get(0)(where), {
        onNone: () => undefined,
        onSome: (clause) => clause,
      });

const createHasUserUpVotedExpr = (userId?: string | null) =>
  userId
    ? sql<boolean>`exists(select 1 from ${schema.upvoteTable} where ${schema.upvoteTable.postId} = ${schema.postTable.id} and ${schema.upvoteTable.userId} = ${userId})`
    : sql<boolean>`false`;

const excerptExpr = sql<string>`coalesce(nullif(${schema.postTable.excerpt}, ''), trim(regexp_replace(regexp_replace(${schema.postTable.content}, '<[^>]+>', ' ', 'gi'), '\\s+', ' ', 'g')))`;

const selectPostFields = (userId?: string | null) => ({
  id: schema.postTable.id,
  title: schema.postTable.title,
  boardId: schema.postTable.boardId,
  slug: schema.postTable.slug,
  content: schema.postTable.content,
  excerpt: excerptExpr,
  upVotes: sql<number>`coalesce((select count(*)::int from ${schema.upvoteTable} where ${schema.upvoteTable.postId} = ${schema.postTable.id}), 0)`,
  statusId: schema.postTable.statusId,
  createdAt: schema.postTable.createdAt,
  updatedAt: schema.postTable.updatedAt,
  organizationId: schema.postTable.organizationId,
  user: {
    name: sql<string | null>`${schema.userTable.name}`,
    image: sql<string | null>`${schema.userTable.image}`,
  },
  hasUserUpVoted: createHasUserUpVotedExpr(userId),
  creatorMemberId: schema.postTable.creatorMemberId,
  creatorId: schema.postTable.creatorId,
  lockedAt: schema.postTable.lockedAt,
  archivedAt: schema.postTable.archivedAt,
  mergedIntoPostId: schema.postTable.mergedIntoPostId,
  mergedAt: schema.postTable.mergedAt,
});

const makePostRepository = Effect.gen(function* () {
  return {
    findByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorId) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
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
          .pipe(Effect.map(EffectArray.get(0)));
      }),

    findByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorIds) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select({ id: schema.postTable.id })
          .from(schema.postTable)
          .where(
            and(
              inArray(schema.postTable.id, ids),
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.creatorId, userId),
              eq(schema.postTable.boardId, boardId)
            )
          );
      }),

    findMany: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [];
      if (boardId) {
        where.push(eq(schema.postTable.boardId, boardId));
      }

      where.push(eq(schema.postTable.organizationId, organizationId));
      const whereClause = getWhereClause(where);

      return Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
          .select(selectPostFields(userId))
          .from(schema.postTable)
          .leftJoin(
            schema.userTable,
            eq(schema.userTable.id, schema.postTable.creatorId)
          )
          .where(whereClause);
      });
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

      return Effect.gen(function* () {
        const db = yield* currentDb;
        return yield* db
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
      });
    },

    isPublicPost: ({ id, organizationId }: TPostById) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
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
        const db = yield* currentDb;
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
        const db = yield* currentDb;
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
    }: TPostUpdate & { excerpt?: string }) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.postTable)
          .set({
            statusId,
            boardId,
            title,
            content,
            excerpt: excerpt ?? htmlToExcerpt(content),
          })
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId)
            )
          );
      }),

    adminUpdate: ({ id, organizationId, archived, locked }: TPostAdminUpdate) =>
      Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .update(schema.postTable)
          .set({
            archivedAt:
              archived === undefined ? undefined : archived ? new Date() : null,
            lockedAt:
              locked === undefined ? undefined : locked ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.postTable.id, id),
              eq(schema.postTable.organizationId, organizationId)
            )
          );
      }),

    delete: ({ id, organizationId, boardId }: TPostDelete) => {
      const where: SQL[] = [];

      if (typeof id === "string") {
        where.push(eq(schema.postTable.id, id));
      } else {
        where.push(inArray(schema.postTable.id, id));
      }

      return Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db
          .delete(schema.postTable)
          .where(
            and(
              ...where,
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.boardId, boardId)
            )
          );
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
      excerpt: inputExcerpt,
    }: TPostCreate) => {
      const excerpt = inputExcerpt ?? htmlToExcerpt(content);

      return Effect.gen(function* () {
        const db = yield* currentDb;
        yield* db.insert(schema.postTable).values({
          id,
          boardId,
          organizationId,
          title,
          content,
          excerpt,
          statusId,
          creatorId,
          ...(creatorMemberId ? { creatorMemberId } : {}),
          createdAt: new Date(),
          slug: slugify(title),
          updatedAt: new Date(),
        });
      });
    },

    merge: ({ organizationId, sourcePostId, targetPostId }: TPostMerge) =>
      transaction(
        Effect.gen(function* () {
          const db = yield* currentDb;
          const posts = yield* db
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

          yield* db
            .update(schema.commentTable)
            .set({ postId: targetPostId })
            .where(eq(schema.commentTable.postId, sourcePostId));

          const upvotes = yield* db
            .select({
              id: schema.upvoteTable.id,
              userId: schema.upvoteTable.userId,
            })
            .from(schema.upvoteTable)
            .where(eq(schema.upvoteTable.postId, sourcePostId));

          for (const upvote of upvotes) {
            const existing = yield* db
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
              yield* db
                .delete(schema.upvoteTable)
                .where(eq(schema.upvoteTable.id, upvote.id));
              continue;
            }

            yield* db
              .update(schema.upvoteTable)
              .set({ postId: targetPostId })
              .where(eq(schema.upvoteTable.id, upvote.id));
          }

          const reactions = yield* db
            .select({
              emoji: schema.postReactionTable.emoji,
              id: schema.postReactionTable.id,
              userId: schema.postReactionTable.userId,
            })
            .from(schema.postReactionTable)
            .where(eq(schema.postReactionTable.postId, sourcePostId));

          for (const reaction of reactions) {
            const existing = yield* db
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
              yield* db
                .delete(schema.postReactionTable)
                .where(eq(schema.postReactionTable.id, reaction.id));
              continue;
            }

            yield* db
              .update(schema.postReactionTable)
              .set({ postId: targetPostId })
              .where(eq(schema.postReactionTable.id, reaction.id));
          }

          const postTags = yield* db
            .select({
              id: schema.postTagTable.id,
              tagId: schema.postTagTable.tagId,
            })
            .from(schema.postTagTable)
            .where(eq(schema.postTagTable.postId, sourcePostId));

          for (const postTag of postTags) {
            const existing = yield* db
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
              yield* db
                .delete(schema.postTagTable)
                .where(eq(schema.postTagTable.id, postTag.id));
              continue;
            }

            yield* db
              .update(schema.postTagTable)
              .set({ postId: targetPostId })
              .where(eq(schema.postTagTable.id, postTag.id));
          }

          yield* db
            .update(schema.postTable)
            .set({
              archivedAt: new Date(),
              mergedAt: new Date(),
              mergedIntoPostId: targetPostId,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(schema.postTable.id, sourcePostId),
                eq(schema.postTable.organizationId, organizationId)
              )
            );
        })
      ),
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
