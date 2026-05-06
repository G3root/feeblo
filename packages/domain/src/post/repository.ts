/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { Database, schema } from "@feeblo/db";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { slugify } from "@feeblo/utils/url";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { Context, Effect, Array as EffectArray, Layer } from "effect";
import type { TPostAdminUpdate, TPostUpdate } from "./schema";

type TPostFindMany = {
  boardId?: string | null | undefined;
  organizationId: string;
  userId?: string | null | undefined;
};

type TPostDelete = {
  id: string | readonly string[];
  organizationId: string;
  boardId: string;
};

type TPostCreate = {
  id: string;
  boardId: string;
  organizationId: string;
  title: string;
  content: string;
  statusId: string;
  creatorId: string;
  creatorMemberId?: string;
};

type TPostMerge = {
  organizationId: string;
  sourcePostId: string;
  targetPostId: string;
};

type TPostFindByCreatorId = {
  id: string;
  organizationId: string;
  userId: string;
  boardId: string;
};

type TPostFindByCreatorIds = {
  ids: readonly string[];
  organizationId: string;
  userId: string;
  boardId: string;
};

type TPostFindManyQuery = {
  whereClause: SQL | undefined;
  userId?: string | null | undefined;
};

const createHasUserUpVotedExpr = (userId?: string | null) =>
  userId
    ? sql<boolean>`exists(select 1 from ${schema.upvote} where ${schema.upvote.postId} = ${schema.post.id} and ${schema.upvote.userId} = ${userId})`
    : sql<boolean>`false`;

const excerptExpr = sql<string>`coalesce(nullif(${schema.post.excerpt}, ''), trim(regexp_replace(regexp_replace(${schema.post.content}, '<[^>]+>', ' ', 'gi'), '\\s+', ' ', 'g')))`;

const selectPostFields = (userId?: string | null) => ({
  id: schema.post.id,
  title: schema.post.title,
  boardId: schema.post.boardId,
  slug: schema.post.slug,
  content: schema.post.content,
  excerpt: excerptExpr,
  upVotes: sql<number>`coalesce((select count(*)::int from ${schema.upvote} where ${schema.upvote.postId} = ${schema.post.id}), 0)`,
  statusId: schema.post.statusId,
  createdAt: schema.post.createdAt,
  updatedAt: schema.post.updatedAt,
  organizationId: schema.post.organizationId,
  user: {
    name: sql<string | null>`${schema.user.name}`,
    image: sql<string | null>`${schema.user.image}`,
  },
  hasUserUpVoted: createHasUserUpVotedExpr(userId),
  creatorMemberId: schema.post.creatorMemberId,
  creatorId: schema.post.creatorId,
  lockedAt: schema.post.lockedAt,
  archivedAt: schema.post.archivedAt,
  mergedIntoPostId: schema.post.mergedIntoPostId,
  mergedAt: schema.post.mergedAt,
});

const makePostRepository = Effect.gen(function* () {
  const db = yield* Database.Database;

  return {
    findByCreatorId: ({
      id,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorId) =>
      db
        .makeQuery((execute, input: TPostFindByCreatorId) =>
          execute((client) =>
            client
              .select({ id: schema.post.id })
              .from(schema.post)
              .where(
                and(
                  eq(schema.post.id, input.id),
                  eq(schema.post.organizationId, input.organizationId),
                  eq(schema.post.creatorId, input.userId),
                  eq(schema.post.boardId, input.boardId)
                )
              )
          )
        )({ id, organizationId, userId, boardId })
        .pipe(Effect.map(EffectArray.get(0))),

    findByCreatorIds: ({
      ids,
      organizationId,
      userId,
      boardId,
    }: TPostFindByCreatorIds) =>
      db.makeQuery((execute, input: TPostFindByCreatorIds) =>
        execute((client) =>
          client
            .select({ id: schema.post.id })
            .from(schema.post)
            .where(
              and(
                inArray(schema.post.id, input.ids),
                eq(schema.post.organizationId, input.organizationId),
                eq(schema.post.creatorId, input.userId),
                eq(schema.post.boardId, input.boardId)
              )
            )
        )
      )({ ids, organizationId, userId, boardId }),

    findMany: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [];
      if (boardId) {
        where.push(eq(schema.post.boardId, boardId));
      }

      where.push(eq(schema.post.organizationId, organizationId));
      const whereClause = where.length > 1 ? and(...where) : where[0];

      return db.makeQuery((execute, input: TPostFindManyQuery) =>
        execute((client) =>
          client
            .select(selectPostFields(input.userId))
            .from(schema.post)
            .leftJoin(schema.user, eq(schema.user.id, schema.post.creatorId))
            .where(input.whereClause)
        )
      )({ whereClause, userId });
    },

    findManyPublic: ({ boardId, organizationId, userId }: TPostFindMany) => {
      const where: SQL[] = [eq(schema.post.organizationId, organizationId)];
      if (boardId) {
        where.push(eq(schema.post.boardId, boardId));
      }
      where.push(eq(schema.board.visibility, "PUBLIC"));

      const whereClause = and(...where);

      return db.makeQuery((execute, input: TPostFindManyQuery) =>
        execute((client) =>
          client
            .select(selectPostFields(input.userId))
            .from(schema.post)
            .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
            .leftJoin(schema.user, eq(schema.user.id, schema.post.creatorId))
            .where(input.whereClause)
        )
      )({ whereClause, userId });
    },

    isPublicPost: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .makeQuery((execute, input: { id: string; organizationId: string }) =>
          execute((client) =>
            client
              .select({ id: schema.post.id })
              .from(schema.post)
              .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
              .where(
                and(
                  eq(schema.post.id, input.id),
                  eq(schema.post.organizationId, input.organizationId),
                  eq(schema.board.visibility, "PUBLIC")
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    isUnlocked: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .makeQuery((execute, input: { id: string; organizationId: string }) =>
          execute((client) =>
            client
              .select({ id: schema.post.id })
              .from(schema.post)
              .where(
                and(
                  eq(schema.post.id, input.id),
                  eq(schema.post.organizationId, input.organizationId),
                  sql`${schema.post.lockedAt} is null`
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    isUnlockedPublic: ({
      id,
      organizationId,
    }: {
      id: string;
      organizationId: string;
    }) =>
      db
        .makeQuery((execute, input: { id: string; organizationId: string }) =>
          execute((client) =>
            client
              .select({ id: schema.post.id })
              .from(schema.post)
              .innerJoin(schema.board, eq(schema.board.id, schema.post.boardId))
              .where(
                and(
                  eq(schema.post.id, input.id),
                  eq(schema.post.organizationId, input.organizationId),
                  eq(schema.board.visibility, "PUBLIC"),
                  sql`${schema.post.lockedAt} is null`
                )
              )
          )
        )({ id, organizationId })
        .pipe(Effect.map((rows) => rows.length > 0)),

    update: ({
      id,
      organizationId,
      statusId,
      boardId,
      title,
      content,
    }: TPostUpdate) =>
      db
        .makeQuery((execute, input: TPostUpdate) =>
          execute((client) =>
            client
              .update(schema.post)
              .set({
                statusId: input.statusId,
                boardId: input.boardId,
                title: input.title,
                content: input.content,
                excerpt: htmlToExcerpt(input.content),
              })
              .where(
                and(
                  eq(schema.post.id, input.id),
                  eq(schema.post.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId, statusId, boardId, title, content })
        .pipe(Effect.asVoid),

    adminUpdate: ({ id, organizationId, archived, locked }: TPostAdminUpdate) =>
      db
        .makeQuery((execute, input: TPostAdminUpdate) =>
          execute((client) =>
            client
              .update(schema.post)
              .set({
                archivedAt:
                  input.archived === undefined
                    ? undefined
                    : input.archived
                      ? new Date()
                      : null,
                lockedAt:
                  input.locked === undefined
                    ? undefined
                    : input.locked
                      ? new Date()
                      : null,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(schema.post.id, input.id),
                  eq(schema.post.organizationId, input.organizationId)
                )
              )
          )
        )({ id, organizationId, archived, locked })
        .pipe(Effect.asVoid),

    delete: ({ id, organizationId, boardId }: TPostDelete) => {
      const where: SQL[] = [];

      if (typeof id === "string") {
        where.push(eq(schema.post.id, id));
      } else {
        where.push(inArray(schema.post.id, id));
      }

      return db
        .makeQuery((execute, input: { where: SQL[]; organizationId: string; boardId: string }) =>
          execute((client) =>
            client
              .delete(schema.post)
              .where(
                and(
                  ...input.where,
                  eq(schema.post.organizationId, input.organizationId),
                  eq(schema.post.boardId, input.boardId)
                )
              )
          )
        )({ where, organizationId, boardId })
        .pipe(Effect.asVoid);
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
    }: TPostCreate) => {
      const excerpt = htmlToExcerpt(content);

      return db
        .makeQuery((execute, input: TPostCreate & { excerpt: string }) =>
          execute((client) =>
            client.insert(schema.post).values({
              id: input.id,
              boardId: input.boardId,
              organizationId: input.organizationId,
              title: input.title,
              content: input.content,
              excerpt: input.excerpt,
              statusId: input.statusId,
              creatorId: input.creatorId,
              ...(input.creatorMemberId
                ? { creatorMemberId: input.creatorMemberId }
                : {}),
              createdAt: new Date(),
              slug: slugify(input.title),
              updatedAt: new Date(),
            })
          )
        )(
          creatorMemberId
            ? {
                id,
                boardId,
                organizationId,
                title,
                content,
                statusId,
                creatorId,
                creatorMemberId,
                excerpt,
              }
            : {
                id,
                boardId,
                organizationId,
                title,
                content,
                statusId,
                creatorId,
                excerpt,
              }
        )
        .pipe(Effect.asVoid);
    },

    merge: ({ organizationId, sourcePostId, targetPostId }: TPostMerge) =>
      db.transaction(
        Effect.gen(function* () {
          const posts = yield* db.makeQuery(
            (execute, input: TPostMerge) =>
              execute((client) =>
                client
                  .select({
                    id: schema.post.id,
                    archivedAt: schema.post.archivedAt,
                    mergedIntoPostId: schema.post.mergedIntoPostId,
                  })
                  .from(schema.post)
                  .where(
                    and(
                      inArray(schema.post.id, [
                        input.sourcePostId,
                        input.targetPostId,
                      ]),
                      eq(schema.post.organizationId, input.organizationId)
                    )
                  )
              )
          )({ organizationId, sourcePostId, targetPostId });

          const sourcePost = posts.find((post) => post.id === sourcePostId);
          const targetPost = posts.find((post) => post.id === targetPostId);

          if (
            !(sourcePost && targetPost) ||
            sourcePostId === targetPostId ||
            sourcePost.mergedIntoPostId ||
            sourcePost.archivedAt ||
            targetPost.mergedIntoPostId ||
            targetPost.archivedAt
          ) {
            return;
          }

          yield* db.makeQuery(
            (execute, input: { sourcePostId: string; targetPostId: string }) =>
              execute((client) =>
                client
                  .update(schema.comment)
                  .set({ postId: input.targetPostId })
                  .where(eq(schema.comment.postId, input.sourcePostId))
              )
          )({ sourcePostId, targetPostId });

          const upvotes = yield* db.makeQuery(
            (execute, input: { sourcePostId: string }) =>
              execute((client) =>
                client
                  .select({
                    id: schema.upvote.id,
                    userId: schema.upvote.userId,
                  })
                  .from(schema.upvote)
                  .where(eq(schema.upvote.postId, input.sourcePostId))
              )
          )({ sourcePostId });

          for (const upvote of upvotes) {
            const [existing] = yield* db.makeQuery(
              (execute, input: { targetPostId: string; userId: string }) =>
                execute((client) =>
                  client
                    .select({ id: schema.upvote.id })
                    .from(schema.upvote)
                    .where(
                      and(
                        eq(schema.upvote.postId, input.targetPostId),
                        eq(schema.upvote.userId, input.userId)
                      )
                    )
                    .limit(1)
                )
            )({ targetPostId, userId: upvote.userId });

            if (existing) {
              yield* db.makeQuery((execute, input: { id: string }) =>
                execute((client) =>
                  client.delete(schema.upvote).where(eq(schema.upvote.id, input.id))
                )
              )({ id: upvote.id });
              continue;
            }

            yield* db.makeQuery(
              (execute, input: { id: string; targetPostId: string }) =>
                execute((client) =>
                  client
                    .update(schema.upvote)
                    .set({ postId: input.targetPostId })
                    .where(eq(schema.upvote.id, input.id))
                )
            )({ id: upvote.id, targetPostId });
          }

          const reactions = yield* db.makeQuery(
            (execute, input: { sourcePostId: string }) =>
              execute((client) =>
                client
                  .select({
                    emoji: schema.postReaction.emoji,
                    id: schema.postReaction.id,
                    userId: schema.postReaction.userId,
                  })
                  .from(schema.postReaction)
                  .where(eq(schema.postReaction.postId, input.sourcePostId))
              )
          )({ sourcePostId });

          for (const reaction of reactions) {
            const [existing] = yield* db.makeQuery(
              (
                execute,
                input: {
                  targetPostId: string;
                  userId: string;
                  emoji: string;
                }
              ) =>
                execute((client) =>
                  client
                    .select({ id: schema.postReaction.id })
                    .from(schema.postReaction)
                    .where(
                      and(
                        eq(schema.postReaction.postId, input.targetPostId),
                        eq(schema.postReaction.userId, input.userId),
                        eq(schema.postReaction.emoji, input.emoji)
                      )
                    )
                    .limit(1)
                )
            )({
              targetPostId,
              userId: reaction.userId,
              emoji: reaction.emoji,
            });

            if (existing) {
              yield* db.makeQuery((execute, input: { id: string }) =>
                execute((client) =>
                  client
                    .delete(schema.postReaction)
                    .where(eq(schema.postReaction.id, input.id))
                )
              )({ id: reaction.id });
              continue;
            }

            yield* db.makeQuery(
              (execute, input: { id: string; targetPostId: string }) =>
                execute((client) =>
                  client
                    .update(schema.postReaction)
                    .set({ postId: input.targetPostId })
                    .where(eq(schema.postReaction.id, input.id))
                )
            )({ id: reaction.id, targetPostId });
          }

          const postTags = yield* db.makeQuery(
            (execute, input: { sourcePostId: string }) =>
              execute((client) =>
                client
                  .select({
                    id: schema.postTag.id,
                    tagId: schema.postTag.tagId,
                  })
                  .from(schema.postTag)
                  .where(eq(schema.postTag.postId, input.sourcePostId))
              )
          )({ sourcePostId });

          for (const postTag of postTags) {
            const [existing] = yield* db.makeQuery(
              (execute, input: { targetPostId: string; tagId: string }) =>
                execute((client) =>
                  client
                    .select({ id: schema.postTag.id })
                    .from(schema.postTag)
                    .where(
                      and(
                        eq(schema.postTag.postId, input.targetPostId),
                        eq(schema.postTag.tagId, input.tagId)
                      )
                    )
                    .limit(1)
                )
            )({ targetPostId, tagId: postTag.tagId });

            if (existing) {
              yield* db.makeQuery((execute, input: { id: string }) =>
                execute((client) =>
                  client.delete(schema.postTag).where(eq(schema.postTag.id, input.id))
                )
              )({ id: postTag.id });
              continue;
            }

            yield* db.makeQuery(
              (execute, input: { id: string; targetPostId: string }) =>
                execute((client) =>
                  client
                    .update(schema.postTag)
                    .set({ postId: input.targetPostId })
                    .where(eq(schema.postTag.id, input.id))
                )
            )({ id: postTag.id, targetPostId });
          }

          yield* db.makeQuery(
            (
              execute,
              input: { organizationId: string; sourcePostId: string; targetPostId: string }
            ) =>
              execute((client) =>
                client
                  .update(schema.post)
                  .set({
                    archivedAt: new Date(),
                    mergedAt: new Date(),
                    mergedIntoPostId: input.targetPostId,
                    updatedAt: new Date(),
                  })
                  .where(
                    and(
                      eq(schema.post.id, input.sourcePostId),
                      eq(schema.post.organizationId, input.organizationId)
                    )
                  )
              )
          )({ organizationId, sourcePostId, targetPostId });
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
